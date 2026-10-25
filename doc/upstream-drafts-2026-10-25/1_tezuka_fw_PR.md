# DRAFT, not posted. Target: F5OEO/tezuka_fw, from mbehn1976:proposal/system-upgrade (14 commits on a304a1f)

Title: System upgrade: Buildroot 2026.08.1, Linux 6.12.114 (Pluto, Pluto+), libiio 1.0.0

## What this does

| Component | Before | After |
|---|---|---|
| Buildroot | 2026.05.2 | 2026.08.1 (rust-wasm pin 1.96.1 to 1.97.1) |
| ADI kernel pin, all boards | bf1d49f | b486fe8 (still 6.12.77, four commits, none in code the Zynq boards use) |
| Kernel, Pluto and Pluto+ | 6.12.77 + patch dir | 6.12.114 from a patched ADI branch (see Kernel below) |
| libiio, all boards | 0.26 | 1.0.0 (library, iiod, tools), with the libiio.so.0 shim and the 0.x iiod protocol kept |
| zynqrx, pluto_rx, iio_ws_proxy | libiio 0.x API | ported to the 1.0 stream API |
| libad9361-iio, SoapyPlutoSDR, kalibrate, plutotx; satdump, sdr_usb_gadget, pluto_stream | libiio 0.26 | stay on a private real 0.26 (package `libiio0`, `/usr/libiio0/lib`, rpath) |

U-Boot and the bitstreams are not touched.

Commits are small and in dependency order (13 code commits and a doc commit), so a part can be dropped: 1 Buildroot, 2 ADI pin, 3 kernel
(Pluto, Pluto+), 4 libiio 1.0.0 Buildroot patch, 5 `iio_readdev`/`iio_writedev` wrappers (merged into
`iio_rwdev` in 1.0), 6 a 32-bit ARM fix, 7 to 9 the three app ports, 10 and 11 `libiio0`.

Also optional: `cpdetect`, a new blind CP-OFDM detector (board app, package, host tool), as two commits: the
detector (before the libiio patch, 0.x API) and its port to the 1.0 stream API. It is NOT enabled in any
defconfig; enabling it is your decision. Drop those two commits if you only want the upgrade.

## Why

Buildroot 2026.08.1 still packages libiio 0.26 and 1.0.0 is out since 2026-09-22. 1.0 keeps old clients
working (see tests) and the new binary protocol is a little faster for 1.0 clients above 12 MS/s.
The kernel move brings the stable releases 6.12.78 to 6.12.114.

## Things you should know before merging

* **Kernel source.** The Pluto and Pluto+ defconfigs would pin a tarball of `mbehn1976/linux`
  (`tezuka/6.12.114-xlnx-2026r1`, 678c4de70fdf = ADI b486fe8 merged with v6.12.114, 18 conflicts
  resolved, the six `patches/linux/adi-6.12.y` patches applied in tree, plus the DAC fix below).
  ADI has no 6.12.114 branch. If you do not want to depend on my fork, the same branch can be pushed to
  an F5OEO repository and the URL changed, or I can send the kernel changes to ADI first and we pin ADI
  later. Your call. The ADI pin on the other boards is unchanged.
* **libiio is global.** The libiio 1.0.0 patch applies to every board. I built plutoskyr2 only
  (build-verified, not run). Other boards are untested.
* **Kernel fix for a TX tone.** On every image I had (also before this upgrade) the TX kept playing the last
  samples after the last writer stopped (tone at the receiver, 58 to 66 dB). Cause: ADI commit 331f56730c62
  (Dec 2023) dropped `indio_dev->setup_ops = &dds_buffer_setup_ops;` in `cf_axi_dds_buffer_stream.c`, so the
  AXI DAC data select never goes back from DMA to DDS. One line restored in the kernel branch. Hardware-checked
  on both boards, in both directions (see below). Boards on the ADI pin do not have it.
* The `libiio.so.0` shim is binary compatibility only: SoapyPlutoSDR stalls and plutotx reports LowSpeed on it,
  which is why those stay on `libiio0`.
* Image size: `pluto.frm` 24.7 MB, about 78 percent of the 31.5 MB budget.

## Tested

Hardware: original Pluto (flashed from the .frm) and Pluto+ (SD boot), cabled RF link. The full RF suite and the
long tests below were run on my combined test branch; this branch has the same files except my other, unmerged
features (the cpdetect defconfig enable, an unrelated provenance change in post-build.sh), which I checked by
diffing the trees.

This branch was also built and run on its own, with the cpdetect defconfig enable on top (proposal/system-upgrade
plus one commit), from a clean build on both boards (build-verified, then hardware-checked):

* Both boards boot it: kernel 6.12.114, libiio 1.0.0, iiod and maia-httpd running, no new dmesg lines.
* TX tone fix, Pluto TX to Pluto+ RX: tone 73 dB with the data select on DMA while writing; after the writer stops the data
  select is back to 0 and only LO leakage (46 to 47 dB) remains, two start/stop cycles. Pluto+ TX to Pluto RX: tone 62 to 63 dB,
  after stop 32 dB, data select 0.
* The first boot of the Pluto after flashing this build stopped in U-Boot (USB download gadget) and needed a power cycle;
  the next boot was normal. Not reproduced on later flashes of other builds, cause not found.
* The full RF suite could NOT be run on this branch: the suite uses the /iq-waterfall websocket of the complex
  spectrometer (maia-sdr PR 12), which F5OEO main does not have, so every section fails with HTTP 404 there. That is
  a property of the test, not of the upgrade.

Results from the combined branch:

* Full RF suite (70 checks, 30 sections) on both boards after each step: Buildroot, kernel pin, kernel 6.12.114,
  libiio 1.0.0, DAC fix. 70 ok, 0 FAIL on the final images, settings restored 30/30. The kernel-pin-only step had one
  unexplained one-off FAIL that did not reproduce in six reruns.
* Soapy RX 2.49 and 9.9 Msps and TX on both boards; plutotx "Buffer is HighSpeed".
* `iio_ws_proxy`: RX tone about 70 dB SNR; stream TX, cyclic TX and duplex all work.
* Host clients: libiio 0.26 and 1.0.0 open iiod 1.0.0 over IP and USB on both boards.
* Over Ethernet 2.5 to 12.5 MS/s keep up with both client versions; 15 MS/s is 6 to 8 percent slow; 20 MS/s
  takes 4.85 s (1.0) against 5.99 s (0.26) for a 4 s signal.
* One hour soak: 137 iterations, 0 bad (800 MB over Ethernet with a 1.0 client at 10 MS/s and 400 MB over USB with a 0.26 client at the same time); iiod and maia-httpd never restarted.
* TX tone: after the writer stops the data select reads 0 and only LO leakage (32 to 47 dB) remains, two
  start/stop cycles, both boards.

Not tested: Windows and macOS USB hosts against iiod 1.0; the Pluto's own USB link under load; satdump,
sdr_usb_gadget, pluto_stream and DATV on hardware; the other boards; flash writes above 16 MB on the Pluto+.

## Traps for whoever builds it next

After a libiio change run `dirclean` for libiio, libiio0, iio_ws, libad9361-iio, soapyplutosdr, kalibrate
(and `board-fpga` for the Pluto+) and delete the stale 0.26 files from `output/*/staging`; after a kernel
version bump also `maia-kmod-dirclean fl2k-kmod-dirclean`; the rust-wasm pin must match Buildroot's host rustc.
More in doc/system-upgrade-2026-10.md, added in the last commit.
