# System upgrade, October 2026: Buildroot 2026.08.1, Linux 6.12.114, libiio 1.0.0

Written 2026-10-25. "Build-verified" means the image or package compiled and was not run on
hardware. Hardware results were obtained on a combined test branch that contains these changes
plus other, unmerged features; see "Hardware results".

## What changed

| Component | Before | After |
|---|---|---|
| Buildroot | 2026.05.2 | 2026.08.1 (rust-wasm pin 1.96.1 to 1.97.1) |
| ADI kernel pin, all boards | bf1d49f | b486fe8 (still 6.12.77) |
| Kernel, Pluto and Pluto+ | 6.12.77 plus patch directory | 6.12.114 from a patched ADI branch, see below |
| libiio, all boards | 0.26 | 1.0.0 (library, iiod, tools) |
| zynqrx, pluto_rx, iio_ws_proxy | libiio 0.x API | ported to the 1.0 stream API |
| cpdetect (new, optional, not in any defconfig) | n/a | blind CP-OFDM detector written for the 0.x API, ported to 1.0 in a separate commit |
| libad9361-iio, SoapyPlutoSDR, kalibrate, plutotx, and on other boards satdump, sdr_usb_gadget, pluto_stream | libiio 0.26 | stay on 0.26 through the private package `libiio0` |

U-Boot and the FPGA bitstreams are unchanged. The other boards keep the ADI kernel pin and the
patch directory.

## How it is built

* Buildroot: `buildroot.version`, applied by `getbuildroot.sh`. Buildroot 2026.08.1 still ships
  libiio 0.26, so libiio 1.0.0 comes from `patches/buildroot/0006-libiio-update-to-1.0.0.patch`
  (version, hash, zstd, `WITH_UTILS`, `LIBIIO_COMPAT=ON`, `WITH_IIOD_V0_COMPAT=ON`,
  `LOG_LEVEL=Warning`) and `0007` (64-bit popcount and ffs on 32-bit ARM).
* Kernel: the Pluto and Pluto+ defconfigs pin a tarball of mbehn1976/linux, branch
  `tezuka/6.12.114-xlnx-2026r1` (678c4de70fdf): ADI `b486fe8` merged with kernel.org v6.12.114
  (18 merge conflicts), the six patches of `board/tezuka/common/patches/linux/adi-6.12.y` applied
  in the tree, and the DAC fix described below.
* `libiio0`: a second, real libiio 0.26 in `/usr/libiio0/lib`. Consumers link it with an rpath
  (the toolchain emits DT_RPATH, not RUNPATH). The prebuilt `plutotx` gets its rpath from
  `patchelf` in `board/tezuka/common/post-build.sh`.
* `iio_readdev` and `iio_writedev` no longer exist in libiio 1.0 (merged into `iio_rwdev`).
  `board/tezuka/common/overlay_tezuka/usr/bin/iio_readdev` and `iio_writedev` are wrappers so
  existing scripts keep working.
* libiio 1.0 keeps old clients working: `libiio.so.0` is a binary compatibility shim and iiod
  still serves the 0.x protocol; 1.0 clients upgrade to the binary protocol. The 0.x headers are
  not installed, so source built against 0.x needs a port or `libiio0`.

## Traps

* After a libiio change, `dirclean` libiio, libiio0, iio_ws, libad9361-iio, soapyplutosdr,
  kalibrate (and `board-fpga` for the Pluto+) and delete stale 0.26 files from
  `output/*/staging` and `target` (iio.h, libiio.so.0.26, old tools), or consumers compile
  against old headers.
* Every Buildroot bump: `package/rust-wasm/rust-wasm.mk` must match Buildroot's host rustc.
* After a kernel version bump: remove the old `target/lib/modules/<old>` and run
  `maia-kmod-dirclean` and `fl2k-kmod-dirclean`, otherwise `maia-sdr.ko` is built for the old
  kernel and maia-httpd is missing.
* A kernel built with `LINUX_OVERRIDE_SRCDIR` skips the patches; apply them into the tree.
* libiio 1.0.0 on 32-bit ARM: a stream with more than 33 blocks fails with EINVAL
  (`local-mmap.c` uses `popcountl` and `ffsl` on a 64-bit mask). Fixed by patch 0007.
* The 0.x shim prints a banner on stdout at INFO level, which corrupts binary and JSON output
  of shim consumers. `LOG_LEVEL=Warning` fixes it.
* The shim is binary compatibility only. SoapyPlutoSDR stalls in poll and cannot create a TX
  buffer on it, and `plutotx` reports "Buffer is LowSpeed". That is why those use `libiio0`.
* Cyclic TX in libiio 1.0: a second cyclic enqueue on an open buffer returns EBUSY. The ported
  `iio_ws_proxy` closes and reopens the buffer; the 0.x proxy wrote into the playing buffer.
* libiio 1.0 logs "Unable to dequeue block: Bad file descriptor" on stream cancel. Cosmetic.
* CMake 4 needs `-DCMAKE_POLICY_VERSION_MINIMUM=3.5` for the Soapy and libad9361 builds.
* busybox `sh` gives background jobs stdin from /dev/null even with `<&0`; the writer wrapper
  uses `exec 3<&0; cmd <&3 3<&- &`. Always confirm that a tone appears at a receiver.

## Hardware results

Boards: original Pluto (Z7010 Rev.B, flashed from the .frm) and Pluto+ (SD boot), cabled RF
link between them. Run on a combined test branch; the trees differ from this branch only by
the cpdetect defconfig enable and a provenance change in post-build.sh, which are not part of
this branch. This branch itself was not built or run separately.

* Full RF suite (70 checks, 30 sections, settings restored) after each step: Buildroot, kernel
  pin, kernel 6.12.114, libiio 1.0.0, DAC fix. 70 ok, 0 FAIL on the final images. The
  kernel-pin-only step had one unexplained FAIL (Pluto, raw vs magnitude correlation 0.9652 at
  20 MS/s CW) that did not repeat in six reruns.
* Soapy RX 2.49 and 9.9 Msps and TX on both boards; `plutotx` "Buffer is HighSpeed".
* `cpdetect` (enabled in the test branch's defconfigs): finds N=256, G=32 on CP-OFDM, rejects a
  tone, and `cpdetect -l -M` publishes `state/cpdetect/*`.
* `iio_ws_proxy`: RX tone about 70 dB SNR; stream TX, cyclic TX (a second push replaces the
  first) and duplex `-1 -s` (RX 71 dB SNR, TX about 10 MB/s, 0 drops).
* Host clients: libiio 0.26 and a host-built libiio 1.0.0 open iiod 1.0.0 over IP and USB on
  both boards and read data.
* Streaming over Ethernet (not drop-proof): 2.5 to 12.5 MS/s keep up with both client versions;
  15 MS/s is 6 to 8 percent slow; 20 MS/s takes 4.85 s (1.0 client) against 5.99 s (0.26
  client) for a 4 s signal.
* One hour soak: 137 iterations, 0 bad; per iteration 800 MB over Ethernet (1.0 client, 10 MS/s)
  and 400 MB over USB (0.26 client) at the same time from the Pluto+; iiod and maia-httpd never
  restarted, no dmesg warnings, no memory trend.
* `pluto.frm` is 24.7 MB, about 78 percent of the 31.5 MB budget.

## Not tested

* Windows and macOS USB hosts against iiod 1.0; the Pluto's own USB link under load (only the
  Pluto+ USB link was soaked, with a 0.26 client).
* satdump, sdr_usb_gadget, pluto_stream and DATV: only built against `libiio0` on plutoskyr2.
  zynqrx and pluto_rx are in no defconfig.
* All other boards: the libiio 1.0.0 patch applies to them, none was built or run except
  plutoskyr2 (build only).
* Pluto+ QSPI flash writes above 16 MB. Reads of all four partitions matched a backup.
* U-Boot is unchanged and was not touched.

## TX kept transmitting after the writer stopped

Before the fix, after the last writer stopped the DAC kept replaying the last DMA data, so a
tone stayed at the receiver (58 to 66 dB) until the TX gain was lowered. It also happened with
kernel 6.12.77 and libiio 0.26, so the upgrade did not cause it.

Cause: the AXI DAC data select (`CHAN_CNTRL_7`, debugfs `iio:device2` registers `0x0418` and
`0x0458`) is switched to DMA (`0x2`) when a TX buffer is enabled and has to go back to DDS
(`0x0`) when it is disabled. `cf_axi_dds_buffer_stream.c` has the code for that
(`dds_buffer_postdisable` calls `cf_axi_dds_datasel(st, -1, DATA_SEL_DDS)`), but ADI commit
331f56730c62 ("iio: buffer-dma: sync write support with upstream", December 2023) moved the
buffer setup to `devm_iio_dmaengine_buffer_setup_with_ops()` and dropped
`indio_dev->setup_ops = &dds_buffer_setup_ops;`. Since then the preenable and postdisable
callbacks never run.

Fix: assign `indio_dev->setup_ops` again in `cf_axi_dds_configure_buffer()`; it is in kernel
commit 678c4de70fdf, which the Pluto and Pluto+ defconfigs pin. Boards on the ADI pin do not
have it. Checked on both boards: tone 63 to 73 dB while writing, afterwards the data select
reads `0x0` and only LO leakage (32 to 47 dB) remains, on two start and stop cycles.
Workaround on an unfixed kernel: write 0 to both registers through
`/sys/kernel/debug/iio/iio:device2/direct_reg_access` (`echo "0x0418 0" > ...`).
