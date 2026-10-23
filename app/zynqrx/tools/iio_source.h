// Live IQ from the radio's AD936x through libiio (zynqrx rx --iio). Built only with -DZYNQRX_IIO (Makefile: IIO=1, the default for the board).
#pragma once
#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <complex>
#include <cmath>
#include <string>
#include <vector>
#include <sys/types.h>
#if defined(__ARM_NEON)
#include <arm_neon.h>
#endif

#ifdef ZYNQRX_IIO
#include <iio/iio.h>
#include <atomic>
#include <cerrno>

// The AD9361 FIR for DVB-S/S2: root raised cosine that decimates by 4. The converter runs at 4 times the output rate, which is 2 samples per symbol
// (8 per symbol at the FIR's input): the stream the receiver takes with --prefiltered. Taps in 1/32768 with unity gain at DC.
inline std::string rrcFirConfig(int taps, double roll) {
    const double pi = 3.14159265358979323846, a = roll, sps = 8.0;
    std::vector<double> h((size_t)taps);
    double sum = 0;
    for (int i = 0; i < taps; i++) {
        const double x = (i - (taps - 1) / 2.0) / sps;   // time in symbols, centred between the two middle taps
        double v;
        if (std::fabs(x) < 1e-9) v = 1 - a + 4 * a / pi;
        else if (std::fabs(std::fabs(x) - 1 / (4 * a)) < 1e-9) v = a / std::sqrt(2.0) * ((1 + 2 / pi) * std::sin(pi / (4 * a)) + (1 - 2 / pi) * std::cos(pi / (4 * a)));
        else v = (std::sin(pi * x * (1 - a)) + 4 * a * x * std::cos(pi * x * (1 + a))) / (pi * x * (1 - std::pow(4 * a * x, 2)));
        h[(size_t)i] = v;
        sum += v;
    }
    std::string c = "RX 3 GAIN 0 DEC 4\nTX 3 GAIN 0 INT 4\n";
    for (double v : h) { const long long t = std::llround(v / sum * 32768.0); c += std::to_string(t) + "," + std::to_string(t) + "\n"; }
    return c;
}

class IioSource {
public:
    IioSource() = default;
    IioSource(const IioSource&) = delete;
    IioSource& operator=(const IioSource&) = delete;
    ~IioSource() {
        if (stream_) iio_stream_destroy(stream_);
        if (mask_) iio_channels_mask_destroy(mask_);
        if (firOn_ && rxCfg_) {   // the radio goes back to a rate it can run without the FIR
            setRate(std::llround(4 * rate_));
            setFirEn(rxCfg_, 0);
        }
        if (ctx_) iio_context_destroy(ctx_);
    }

    // uri empty = the local context (on the board); otherwise e.g. ip:192.168.2.1 or usb:1.2.5. gainDb < 0 = the radio's slow attack AGC.
    // rrcRoll > 0: the RRC decimate-by-4 FIR with that roll-off; rateHz is then the output rate (2 samples per symbol, 0.52 - 15.36 Msps).
    bool open(const std::string& uri, double rateHz, double freqHz, double bwHz, double gainDb, double rrcRoll = 0, bool cs8 = false) {
        // libiio 1.0 logs "Unable to dequeue block" at error level whenever cancel() ends a read; the failures that matter are reported below
        iio_context_params params = {};
        params.log_level = LEVEL_NOLOG;
        ctx_ = iio_create_context(&params, uri.empty() ? nullptr : uri.c_str());   // no uri: the default context (local on the board)
        if (iio_err(ctx_)) {
            ctx_ = nullptr; fprintf(stderr, "iio: cannot open context %s\n", uri.empty() ? "(default)" : uri.c_str()); return false; }
        const iio_device* phy = iio_context_find_device(ctx_, "ad9361-phy");
        dev_ = iio_context_find_device(ctx_, "cf-ad9361-lpc");
        if (!phy || !dev_) { fprintf(stderr, "iio: ad9361-phy / cf-ad9361-lpc not found\n"); return false; }
        const iio_channel* rxCfg = iio_device_find_channel(phy, "voltage0", false);   // RX path settings
        const iio_channel* lo = iio_device_find_channel(phy, "altvoltage0", true);    // RX LO
        if (!rxCfg || !lo) { fprintf(stderr, "iio: RX channels of ad9361-phy not found\n"); return false; }
        rxCfg_ = rxCfg;
        txCfg_ = iio_device_find_channel(phy, "voltage0", true);   // the TX path has its own sampling_frequency; the FIR config covers both paths
        rate_ = rateHz;
        if (rrcRoll > 0) {
            if (rateHz < 2.083e6 / 4 || rateHz > 61.44e6 / 4) { fprintf(stderr, "iio: the RRC filter needs 0.52 - 15.36 Msps\n"); return false; }
            setFirEn(rxCfg, 0);
            bool loaded = false;
            for (int taps : {96, 64, 48, 32, 16}) {
                long long r = setRate(std::llround(4 * rateHz));
                if (r < 0) { fprintf(stderr, "iio: converter rate %.3f Msps refused (%lld)\n", 4 * rateHz / 1e6, r); break; }
                const std::string cfg = rrcFirConfig(taps, rrcRoll);
                const iio_attr* fa = iio_device_find_attr(phy, "filter_fir_config");
                r = fa ? iio_attr_write_string(fa, cfg.c_str()) : -ENOENT;
                if (r < 0) { fprintf(stderr, "iio: %d tap filter not loaded (%lld)\n", taps, r); continue; }
                r = setFirEn(rxCfg, 1);
                if (r < 0) { fprintf(stderr, "iio: %d tap filter not enabled (%lld)\n", taps, r); continue; }
                firOn_ = true;
                // the converter rounds its rate (2.664 Msps -> 2663997 Hz) and the output rate must be exactly a quarter of what it really runs at
                long long conv = 0, outRate = std::llround(rateHz);
                if (readLL(rxCfg, "sampling_frequency", &conv) == 0 && conv > 0) outRate = conv / 4;
                r = setRate(outRate);
                for (long long d = 1; r < 0 && d <= 2; d++) r = setRate(outRate + (d & 1 ? d : -d + 1));
                if (r < 0) { fprintf(stderr, "iio: output rate %lld Hz refused (%lld), converter %lld Hz, %d taps\n", outRate, r, conv, taps); setFirEn(rxCfg, 0); firOn_ = false; continue; }
                fprintf(stderr, "iio: RRC %.2f decimate by 4 FIR, %d taps\n", rrcRoll, taps);
                loaded = true;
                break;
            }
            if (!loaded) { fprintf(stderr, "iio: the radio did not accept the RRC FIR at %.3f Msps\n", rateHz / 1e6); return false; }
        }
        if ((!firOn_ && writeLL(rxCfg, "sampling_frequency", (long long)rateHz) < 0) ||
            writeLL(rxCfg, "rf_bandwidth", (long long)(bwHz > 0 ? bwHz : rateHz)) < 0 ||
            writeLL(lo, "frequency", (long long)freqHz) < 0) {
            fprintf(stderr, "iio: the radio refused %.3f Msps / %.3f MHz\n", rateHz / 1e6, freqHz / 1e6);
            return false;
        }
        if (gainDb >= 0) {
            writeStr(rxCfg, "gain_control_mode", "manual");
            if (const iio_attr* g = iio_channel_find_attr(rxCfg, "hardwaregain")) (void)iio_attr_write_double(g, gainDb);
        } else
            writeStr(rxCfg, "gain_control_mode", "slow_attack");
        i_ = iio_device_find_channel(dev_, "voltage0", false);
        q_ = iio_device_find_channel(dev_, "voltage1", false);
        if (!i_ || !q_) { fprintf(stderr, "iio: RX data channels not found\n"); return false; }
        // Tezuka firmware: with only the first channel enabled the FPGA sends 8-bit I/Q pairs (half the bytes through memory), with both 16-bit
        if (cs8) {
            const iio_attr* fa = iio_context_find_attr(ctx_, "fw_version");
            const char* fw = fa ? iio_attr_get_static_value(fa) : nullptr;
            std::string low = fw ? fw : "";
            for (auto& c : low) c = (char)tolower((unsigned char)c);
            cs8_ = low.find("tezuka") != std::string::npos;
            if (!cs8_) fprintf(stderr, "iio: cs8 needs Tezuka firmware (%s), staying with 16-bit samples\n", fw ? fw : "unknown");
        }
        mask_ = iio_create_channels_mask(iio_device_get_channels_count(dev_));
        iio_buffer* buf = iio_device_get_buffer(dev_, 0);
        if (!mask_ || !buf) { fprintf(stderr, "iio: cannot create the RX buffer\n"); return false; }
        iio_channel_enable(i_, mask_);
        if (!cs8_) iio_channel_enable(q_, mask_);
        // eight blocks: a few extra ride out the receiver being busy
        stream_ = iio_buffer_create_stream(buf, 8, kBlock, mask_);
        if (iio_err(stream_)) { stream_ = nullptr; fprintf(stderr, "iio: cannot create the RX buffer\n"); return false; }
        return true;
    }

    // Blocks until the next buffer is in; returns the number of samples written to x (at most max), 0 on error. Samples are 12 bit in int16 (full scale 2048).
    size_t read(std::complex<float>* x, size_t max) {
        const iio_block* blk = iio_stream_get_next_block(stream_);
        const int r = iio_err(blk);
        if (r < 0) { if (!cancelled_ && r != -EBADF) fprintf(stderr, "iio: buffer refill failed (%d)\n", r); return 0; }   // cancel() woke it
        const char* p = (const char*)iio_block_first(blk, i_);
        const char* end = (const char*)iio_block_end(blk);
        const ptrdiff_t step = cs8_ ? 2 : 4;
        size_t n = 0;
        if (cs8_) {   // 8-bit I/Q pairs, full scale 128
            const int8_t* s = reinterpret_cast<const int8_t*>(p);
            const size_t pairs = std::min<size_t>((size_t)(end - p) / 2, max);
#if defined(__ARM_NEON)
            float* o = reinterpret_cast<float*>(x);
            const float32x4_t scale = vdupq_n_f32(1.f / 128.f);
            for (; n + 8 <= pairs; n += 8) {   // eight samples (sixteen values) at a time
                const int16x8_t a = vmovl_s8(vld1_s8(s + 2 * n)), b = vmovl_s8(vld1_s8(s + 2 * n + 8));
                vst1q_f32(o + 2 * n, vmulq_f32(vcvtq_f32_s32(vmovl_s16(vget_low_s16(a))), scale));
                vst1q_f32(o + 2 * n + 4, vmulq_f32(vcvtq_f32_s32(vmovl_s16(vget_high_s16(a))), scale));
                vst1q_f32(o + 2 * n + 8, vmulq_f32(vcvtq_f32_s32(vmovl_s16(vget_low_s16(b))), scale));
                vst1q_f32(o + 2 * n + 12, vmulq_f32(vcvtq_f32_s32(vmovl_s16(vget_high_s16(b))), scale));
            }
#endif
            for (; n < pairs; n++) x[n] = std::complex<float>(s[2 * n] * (1.f / 128.f), s[2 * n + 1] * (1.f / 128.f));
            return n;
        }
#if defined(__ARM_NEON)
        if (step == 4) {   // I and Q only: 12-bit samples in int16, four samples (eight values) at a time
            float* o = reinterpret_cast<float*>(x);
            const float32x4_t scale = vdupq_n_f32(1.f / 2048.f);
            for (; p + 16 <= end && n + 4 <= max; p += 16, n += 4) {
                const int16x8_t v = vld1q_s16(reinterpret_cast<const int16_t*>(p));
                vst1q_f32(o + 2 * n, vmulq_f32(vcvtq_f32_s32(vmovl_s16(vget_low_s16(v))), scale));
                vst1q_f32(o + 2 * n + 4, vmulq_f32(vcvtq_f32_s32(vmovl_s16(vget_high_s16(v))), scale));
            }
        }
#endif
        for (; p < end && n < max; p += step, n++) {
            const int16_t* s = (const int16_t*)p;
            x[n] = std::complex<float>(s[0] * (1.f / 2048.f), s[1] * (1.f / 2048.f));
        }
        return n;
    }

    // Wakes a read() that waits for the next buffer (from another thread); that read() then returns 0
    void cancel() { cancelled_ = true; if (stream_) iio_stream_cancel(stream_); }
    // the gain the radio runs at now (dB), -1 when it cannot be read
    int gainDb() const {
        double g = -1;
        const iio_attr* a = rxCfg_ ? iio_channel_find_attr(rxCfg_, "hardwaregain") : nullptr;
        return a && iio_attr_read_double(a, &g) == 0 ? (int)std::lround(g) : -1;
    }

    static constexpr size_t kBlock = 1 << 16;

private:
    iio_context* ctx_ = nullptr;
    const iio_device* dev_ = nullptr;
    const iio_channel *i_ = nullptr, *q_ = nullptr;
    iio_channels_mask* mask_ = nullptr;
    iio_stream* stream_ = nullptr;
    std::atomic<bool> cancelled_{false};
    const iio_channel* rxCfg_ = nullptr;
    const iio_channel* txCfg_ = nullptr;
    // channel attributes (0.x: iio_channel_attr_*); a missing attribute is -ENOENT
    static long long readLL(const iio_channel* c, const char* name, long long* v) {
        const iio_attr* a = iio_channel_find_attr(c, name);
        return a ? iio_attr_read_longlong(a, v) : -ENOENT;
    }
    static long long writeLL(const iio_channel* c, const char* name, long long v) {
        const iio_attr* a = iio_channel_find_attr(c, name);
        return a ? iio_attr_write_longlong(a, v) : -ENOENT;
    }
    static long long writeStr(const iio_channel* c, const char* name, const char* v) {
        const iio_attr* a = iio_channel_find_attr(c, name);
        return a ? iio_attr_write_string(a, v) : -ENOENT;
    }
    // the sampling frequency of the RX path and of the TX path (what iio_attr -c voltage0 does: both)
    // filter_fir_en is a separate switch for the RX and the TX path on this kernel (in_voltage_ / out_voltage_ filter_fir_en); the FIR config covers both
    long long setFirEn(const iio_channel* rx, long long on) {
        const long long r = writeLL(rx, "filter_fir_en", on);
        if (txCfg_) writeLL(txCfg_, "filter_fir_en", on);
        return r;
    }
    long long setRate(long long hz) {
        const long long r = writeLL(rxCfg_, "sampling_frequency", hz);
        if (txCfg_) writeLL(txCfg_, "sampling_frequency", hz);
        return r;
    }
    bool firOn_ = false, cs8_ = false;
    double rate_ = 0;
};
#else
class IioSource {
public:
    bool open(const std::string&, double, double, double, double, double = 0, bool = false) { fprintf(stderr, "this build has no libiio (build with IIO=1)\n"); return false; }
    size_t read(std::complex<float>*, size_t) { return 0; }
    void cancel() {}
    int gainDb() const { return -1; }
    static constexpr size_t kBlock = 1 << 16;
};
#endif
