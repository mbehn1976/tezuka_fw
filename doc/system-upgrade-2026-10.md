# System upgrade, October 2026: Buildroot 2026.08.1, Linux 6.12.114, libiio 1.0.0

Status of this document: written 2026-10-24 for the fork branch `upgrade/libiio-1.0.0`
(mbehn1976/tezuka_fw). Nothing described here has been proposed to or merged by F5OEO.
Every result below says what it was tested on. "Build-verified" means the image or package
compiled and was not run on hardware.

## What changed

| Component | Before | After | Commit |
|---|---|---|---|
| Buildroot | 2026.05.2 | 2026.08.1 (rust-wasm pin 1.96.1 to 1.97.1) | 047922e |
| ADI kernel pin | bf1d49f | b486fe8 (K1, still 6.12.77) | f802a0e |
| Kernel (Pluto, Pluto+) | 6.12.77 | 6.12.114 (K2), tarball from the fork mbehn1976/linux, branch `tezuka/6.12.114-xlnx-2026r1` (678c4de70fdf, includes the DAC data select fix) | 3951671 and the pin bump |
| libiio | 0.26 | 1.0.0 (library, iiod, tools) | 86d3fc2, c5666ad, dd49599 |
| Programs using the libiio API | 0.x API | `cpdetect`, `zynqrx`, `pluto_rx`, `iio_ws_proxy` ported to 1.0 | dd1270a, a244b51, 2db939e, 293cd3a |
| Programs that stay on 0.26 | n/a | `libad9361-iio`, SoapyPlutoSDR, kalibrate, the prebuilt `/root/plutotx`, and on the other boards `satdump`, `sdr_usb_gadget`, `pluto_stream`, built against the private package `libiio0` | 8d789d6, a298435 |
| Dashboard raw capture button | sent `start` (HTTP 422) | sends `Start` | 58257c5 |

U-Boot and the FPGA bitstream are unchanged. U-Boot is only to be touched with a UART console
and a recovery path (no adapter yet). The kernel is 6.12.114 for Pluto and Pluto+ only; the other
boards keep the ADI K1 pin and the patch directory.

## How it is built

* Buildroot: `buildroot.version`, applied by `getbuildroot.sh`. Buildroot 2026.08.1 still ships
  libiio 0.26, so libiio 1.0.0 is added by `patches/buildroot/0006-libiio-update-to-1.0.0.patch`
  (version, hash, zstd, `WITH_UTILS`, `LIBIIO_COMPAT=ON`, `WITH_IIOD_V0_COMPAT=ON`,
  `LOG_LEVEL=Warning`) and `0007` (64-bit popcount/ffs on 32-bit ARM, see below).
* Kernel: the Pluto and Pluto+ defconfigs pin the tarball of the fork branch above (ADI
  `b486fe8` merged with kernel.org v6.12.114, 18 merge conflicts, plus the 6 Tezuka patches and the DAC fix applied in tree).
* `libiio0`: a second, real libiio 0.26 installed in `/usr/libiio0/lib`; consumers link it with an
  rpath (the toolchain emits DT_RPATH, not RUNPATH). The prebuilt `plutotx` gets its rpath from
  `patchelf` in `board/tezuka/common/post-build.sh`.
* `iio_readdev` and `iio_writedev` no longer exist in libiio 1.0 (merged into `iio_rwdev`).
  `board/tezuka/common/overlay_tezuka/usr/bin/iio_readdev` and `iio_writedev` are wrappers so
  existing scripts and the hwtest tools keep working.

## Traps for the next person

* After a libiio change, `dirclean` libiio, libiio0, cpdetect, iio_ws, libad9361-iio,
  soapyplutosdr, kalibrate (and `board-fpga` for the Pluto+) and delete stale 0.26 files from
  `output/*/staging` and `target` (iio.h, libiio.so.0.26, the old tools), or consumers compile
  against old headers.
* Every Buildroot bump: `package/rust-wasm/rust-wasm.mk` must match Buildroot's host rustc.
* After a kernel version bump: remove the old `target/lib/modules/<old>` and `maia-kmod-dirclean`,
  `fl2k-kmod-dirclean`, otherwise `maia-sdr.ko` is built for the old kernel and maia-httpd is missing.
* A kernel built with `LINUX_OVERRIDE_SRCDIR` skips the patches; apply them into the tree yourself.
* libiio 1.0.0 on 32-bit ARM: a stream with more than 33 blocks fails with EINVAL
  (`local-mmap.c` uses `popcountl`/`ffsl` on a 64-bit mask). Fixed by Buildroot patch 0007.
* The 0.x compatibility shim (`libiio.so.0`) prints a banner on stdout at INFO level, which
  corrupts binary and JSON output of shim consumers. `LOG_LEVEL=Warning` fixes it.
* The compatibility shim is binary compatibility only. SoapyPlutoSDR stalls in poll and cannot
  create a TX buffer on it, and `plutotx` reports "Buffer is LowSpeed". That is why those programs
  use `libiio0`.
* Cyclic TX in libiio 1.0: a second cyclic enqueue on an open buffer returns EBUSY. The ported
  `iio_ws_proxy` closes and reopens the buffer; the 0.x proxy wrote into the playing buffer.
* libiio 1.0 logs "Unable to dequeue block: Bad file descriptor" on stream cancel. Cosmetic.
* CMake 4 needs `-DCMAKE_POLICY_VERSION_MINIMUM=3.5` for the Soapy and libad9361 builds.
* busybox `sh` gives background jobs stdin from /dev/null even with `<&0`; the writer wrapper uses
  `exec 3<&0; cmd <&3 3<&- &`. A weak check ("one writer, one buffer") passed while the wrapper
  sent zeros, so always confirm that a tone appears at a receiver.
* After a card write, check the board's `/boot` checksums against the image (dirty FAT volumes).
* A background "completed" notification can fire when only the launcher exits; check with `pgrep`.

## Hardware results

Boards: original Pluto (Z7010 Rev.B, flashed from the `.frm`, ejected by the user) and Pluto+
(SD boot). Cabled RF link between them (about +48.3 kHz offset).

* Buildroot step: both boards, full RF suite 70 ok, 0 FAIL, 30 sections, settings restored.
* K1 (kernel pin only): both boards, 69 ok and 1 FAIL (Pluto, `raw_vs_mag_log_corr` 0.9652 at
  20 MS/s CW); six reruns all ok. Unexplained one-off, like an earlier OFDM one-off.
* K2 (kernel 6.12.114): both boards, 70 ok, 0 FAIL. The tarball-pinned images
  (`k2-tarball-newdash14`) are build-verified only; the same sources were tested as `k2-newdash13`.
* libiio 1.0.0, shipped images `libiio1-newdash16` (device-fw `tezuka-v0.3.24-67-g8d78`):
  both boards, full suite 70 ok, 0 FAIL, 30 sections, restores matched.
  * Soapy RX 2.49 and 9.9 Msps and TX on both boards; `plutotx` "Buffer is HighSpeed".
  * `cpdetect` finds N=256, G=32 on CP-OFDM and rejects a tone; `cpdetect -l -M` publishes
    `state/cpdetect/*`.
  * Shipped `iio_ws_proxy`: RX tone about 70 dB SNR; stream TX, cyclic TX (second push replaces
    the first) and duplex `-1 -s` (RX 71 dB SNR, TX about 10 MB/s, 0 drops) all work.
  * Host clients: libiio 0.26 and a host-built libiio 1.0.0 open iiod 1.0.0 over IP and USB on
    both boards and read data. 1.0 clients upgrade to the binary protocol; 0.x clients keep working.
  * Streaming ceiling over Ethernet (not drop-proof): 2.5 to 12.5 MS/s keep up with both client
    versions; 15 MS/s is 6 to 8 percent slow; 20 MS/s is 4.85 s (1.0 client) against 5.99 s (0.26)
    for a 4 s signal.
  * One hour soak: 137 iterations, 0 bad; per iteration 800 MB over Ethernet (1.0 client, 10 MS/s)
    and 400 MB over USB (0.26 client) at the same time from the Pluto+; iiod and maia-httpd never
    restarted, no dmesg warnings, no memory trend.
* `libiio1-newdash17` (device-fw `tezuka-v0.3.24-69-g5825`; Pluto flashed from the `.frm`, Pluto+
  written to SD): differs from newdash16 only by the dashboard raw capture fix; the full suite
  was not rerun on it. `pluto.frm` is 24,699,899 bytes (about 78
  percent of the 31.5 MB budget), md5 `d0dea0cb85c2419ecb9ba1aef818fd4e`.
* Dashboard pages checked in Chrome on both boards: Spectrum, Radio Astronomy, Signal Classifier
  (with the CP-OFDM detector card), Complex I/Q, IQ Tape (record, 13.7 s of cs16 without gaps),
  Raw Complex Capture (PATCH 200, status Stopped, download starts); no JavaScript errors captured.

## Not tested

* Windows and macOS USB hosts against iiod 1.0; the Pluto's own USB link under load (only the
  Pluto+ USB link was soaked, and with a 0.26 client).
* `satdump`, `sdr_usb_gadget`, `pluto_stream`, DATV: only built against `libiio0` on plutoskyr2;
  not run on hardware. `zynqrx` and `pluto_rx` are in no defconfig (not in any image).
* The content of downloaded raw capture files from the button (the backend capture was checked
  through the API: 262144 samples).
* U-Boot (no UART console), and F5OEO's reaction (no reply on any PR as of 2026-10-22).

## Finding and fix: TX kept transmitting after the writer stopped

Before the fix, after the last writer stopped, the DAC kept replaying the last DMA data, so a tone
stayed at the receiver (58 to 66 dB) until the TX gain was lowered. It happened on the
pre-upgrade images `combined-newdash10` (kernel 6.12.77, libiio 0.26) as well, so it is not caused
by this upgrade.

Cause: the AXI DAC data select (`CHAN_CNTRL_7`, debugfs `iio:device2` registers `0x0418` and
`0x0458`) is switched to DMA (`0x2`) when a TX buffer is enabled and has to go back to DDS (`0x0`)
when it is disabled. `cf_axi_dds_buffer_stream.c` has the code for that (`dds_buffer_postdisable`
calls `cf_axi_dds_datasel(st, -1, DATA_SEL_DDS)`), but ADI commit 331f56730c62 ("iio: buffer-dma:
sync write support with upstream", December 2023) moved the buffer setup to
`devm_iio_dmaengine_buffer_setup_with_ops()` and dropped the line
`indio_dev->setup_ops = &dds_buffer_setup_ops;`. Since then the preenable and postdisable
callbacks never run.

Fix: assign `indio_dev->setup_ops` again in `cf_axi_dds_configure_buffer()`. Commit
`678c4de70fdf` on the kernel fork branch `tezuka/6.12.114-xlnx-2026r1`, which the Pluto and Pluto+
defconfigs now pin. Other boards use the ADI K1 pin and do not have the fix.

Checked on hardware: Pluto and Pluto+, tone while writing 63 to 73 dB, after the writer stops the
data select reads `0x0` and only the LO leakage (32 to 47 dB) remains, on two start/stop cycles.
Manual workaround on an unfixed kernel: write 0 to both registers through
`/sys/kernel/debug/iio/iio:device2/direct_reg_access` (`echo "0x0418 0" > ...`); writing the DDS
scale through sysfs does not help. Not reported to ADI.

## Branches on the fork (mbehn1976/tezuka_fw)

* `upgrade/buildroot-2026.08.1`, `upgrade/kernel-adi-b486fe8`, `upgrade/kernel-stable-6.12.114`,
  `upgrade/libiio-1.0.0` (stacked in this order; the last one contains everything above).
* `dashboard-axes-complex-iq`: PR 500 head (964c426, includes the capture button fix).
* `test/combined-newdash9`, `test/combined-newdash10`, `test/allfixes-pr12-layout-main`: combined
  test branches the upgrade is based on (they carry the PR 12 spectrometer pin, PR 500 dashboard,
  PR 504 device-tree nodes, `cpdetect`, and the independent fix PRs).
* `backup/*`: older local branches and snapshots of two worktrees with uncommitted changes
  (`backup/wip-tezuka_fw-2026-10-24`, `backup/wip-f1f4-2026-10-24`).
* Kernel: fork `mbehn1976/linux`, branch `tezuka/6.12.114-xlnx-2026r1` (678c4de70fdf: ADI b486fe8 merged with v6.12.114, the 6 Tezuka patches, the DAC fix).

Upstream proposals are a separate decision: the Buildroot patch, the kernel tarball and the
application ports could become small PRs to F5OEO, in this order, only after asking.
