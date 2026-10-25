# Linux 7.x and PREEMPT_RT on the Pluto+ (plan, state 2026-10-25)

Goal: deterministic latency (worst case below 50 us) and no I/Q buffer drops on the Pluto+, starting from `dev/next`
(= `upgrade/all-features` 32c3a90: Buildroot 2026.08.1, kernel 6.12.114, libiio 1.0.0, maia-sdr 415cea9).
Scope: Pluto+ only, SD boot (`boot: sdboot`), nothing is written to QSPI. Nothing in this file has been built or run yet; it is a plan.

## 1. Facts found in the tree and upstream (checked 2026-10-25)

| Topic | Finding |
|---|---|
| Linux 7.3 | Not released. The newest tag on kernel.org stable git is `v7.3-rc7`. Plan against rc7, re-pin to the final tag. |
| ARM PREEMPT_RT | `ARCH_SUPPORTS_RT` is selected in `arch/arm/Kconfig` at v7.3-rc7. It is absent in our 6.12 kernel (`678c4de70fdf`), so `CONFIG_PREEMPT_RT=y` cannot be set there without a backport from the `-rt` series. |
| ADI Zynq tree | `analogdevicesinc/linux` `xlnx-main` (2026-10-23) and `xlnx/release/v6.12.y-2026r1` are 6.12 based. There is no 7.x ADI Zynq branch, so ad9361, cf_axi_*, axi-dmac and our patches must be forward-ported by us. |
| Kernel source of the build | `configs/plutoplus_maiasdr_defconfig`: tarball pin of `mbehn1976/linux` commit `678c4de70fdf` (ADI b486fe8 + v6.12.114, six patches in tree, DAC `setup_ops` fix). Config `board/tezuka/common/kernel/zynq_pluto_linux_defconfig` plus fragment `board/tezuka/plutoplus/kernel/fragment/frag1.config`. DTS dir `board/tezuka/plutoplus/kernel-dts`. |
| Ethernet | `gem0` (Cadence MACB, `rgmii-id`) with a Realtek RTL8211E PHY in `board/tezuka/plutoplus/dts/zynq-plutoplus.dts`. It is not a LAN9512. USB is `usb0` (ChipIdea gadget, started by `board/tezuka/common/overlay_base/etc/init.d/S23udc`). |
| Reference clock | `clock_extern_en` and `clock_internal_en` nodes are deleted in `zynq-plutoplus.dts`; clock selection is not a DT feature on this board. Keep that as it is. |
| Kernel config today | `PREEMPT=y`, `HZ_1000`, `HIGH_RES_TIMERS=y`, `CPU_IDLE=y`, `COMPACTION` not set, `CMA=y` (64 MB), no `CPU_FREQ`, no `NO_HZ_FULL`. |
| Boot args today | `board/tezuka/common/uboot-env.txt`: `console=ttyPS0,115200 ... clk_ignore_unused cpuidle.off=1` (SD variants use `root=/dev/mmcblk0p2`); `maxcpus=${maxcpus}` in the other variants. |
| `dma_map_sg` conversion | Not needed: no `dma_map_sg(` call in `drivers/iio` or `dma-axi-dmac.c` of our tree. `struct iio_info.read_raw` has the same signature at v7.3-rc7. Compile errors of the real port are recorded in section 4 as they appear, not guessed. |
| Existing helpers | `tools/iq_continuity`, `board/tezuka/common/overlay_tezuka/usr/bin/iio_readdev` (wrapper around `iio_rwdev`), hwtest `sd_write.sh` and `suite.sh` (outside the repo, in `~/tezuka-review-v0.3.23/hwtest`). |

## 2. Differences from the original task text

- Paths are `board/tezuka/...`, not `board/pluto/...`; the defconfig is `configs/plutoplus_maiasdr_defconfig`, not `tezuka_pluto_defconfig`; there is no
  `zynq-pluto-sdr-pluto-plus.dts` (the file is `zynq-plutoplus.dts`).
- 61.44 MSPS through `iio_readdev` over Ethernet or USB is not reachable. Measured ceiling on this rig: continuous at 2.5 and 10 MS/s, drops above about
  12 MS/s over Ethernet (about 50 MB/s). The zero-drop target for the network path is 10 MS/s; 61.44 MS/s is only testable on the board itself
  (maia-hdl / `iio_ws_proxy` local path) and is reported separately.
- The USB link is `192.168.4.1` (Pluto+ USB gadget network), Ethernet is `192.168.3.1`. The 7.3 kernel does not change that.
- Isolating core 1 on a dual Cortex-A9 leaves core 0 for networking, iiod, maia-httpd and the web UI. Whether that is acceptable is measured in stage 4, not assumed.

## 3. Stages (each has a gate; build-verified is never reported as hardware-verified)

0. **This document.** Gate: committed locally on `dev/next`, nothing pushed.
1. **Baseline on the current kernel.** Pluto+ on the g32c3 image. Add `rt-tests` and `stress-ng` to an SD-only test config (check that the Buildroot 2026.08.1
   package names exist before relying on them), run section 6 idle and loaded, and the `iio_readdev` drop test at 2.5 and 10 MS/s over Ethernet.
   Gate: numbers recorded. This shows whether RT is needed at all for zero drops.
2. **RT on 6.12.** Fork branch `tezuka/6.12.114-rt` from `678c4de70fdf` with the `-rt` series for 6.12 (or only the ARM RT enablement commits), config
   `PREEMPT_RT=y`. Boot on the Pluto+ SD. Gate: boots, only the known dmesg lines (cpuidle, spi-nor ear reg), full RF suite 70/70 (`suite.sh`), tone fix still
   works, latency compared with stage 1.
3. **Forward-port to 7.3.** Only if stage 2 shows RT helps. Branch `tezuka/7.3-xlnx` in `mbehn1976/linux` from the 7.3 tag. Bring over ADI `ad9361-phy`,
   `cf_axi_adc`, `cf_axi_dds`, ADI `axi-dmac`, the six patches from `board/tezuka/common/patches/linux/adi-6.12.y/` (0002, 0004, 0006, 0007, 0008, 005) and the DAC fix.
   Fix compile errors file by file and note each in section 4. `make dtbs_check` on `zynq-plutoplus.dts`. Gate: as stage 2, plus libiio 1.0 local backend streaming (DMABUF vs ADI mmap).
4. **Tuning.** `isolcpus=1 nohz_full=1 rcu_nocbs=1`, `S99realtime` (section 5), `NO_HZ_FULL` only if it measurably helps. Gate: jitter and drop numbers, web UI responsiveness.
5. **QSPI and the original Pluto** only after the Pluto+ SD result is complete. The Pluto is flashed and ejected by the user.

Branch and rollback: the running images `known_good/*-fresh-g32c3*` and `*-allfeat-gb6c3*` stay as rollback; an SD card write is always reversible.

## 4. Porting log (filled during stage 3)

Per driver: file, error text, fix. Empty until the first 7.3 build. Known places to look first: the six ADI patches, `drivers/iio/frequency/cf_axi_dds*.c`
(`indio_dev->setup_ops`), `drivers/iio/adc/cf_axi_adc*`, `drivers/iio/buffer/industrialio-buffer-dma*`, `drivers/dma/dma-axi-dmac.c`, `drivers/iio/adc/ad9361*`.

## 5. Kernel config delta and real-time start script (drafts, untested)

Kernel config (stage 2 and 3): `CONFIG_PREEMPT_RT=y` (replaces `PREEMPT=y`), `CONFIG_HIGH_RES_TIMERS=y`, `# CONFIG_CPU_FREQ is not set`,
`# CONFIG_COMPACTION is not set` (already), `CONFIG_CPU_IDLE`: keep `cpuidle.off=1` on the command line or set `# CONFIG_CPU_IDLE`; `NO_HZ_FULL` and
`RCU_NOCB_CPU` in stage 4 only. Check the SMP and `maxcpus` variables in `uboot-env.txt` first.

Boot args for stage 4 (SD variants in `uboot-env.txt`): append `isolcpus=1 nohz_full=1 rcu_nocbs=1`.

`board/tezuka/common/overlay_base/etc/init.d/S99realtime` (new, stage 4):

```sh
#!/bin/sh
# Pin IRQs to core 0, the AXI DMA IRQ to core 1, run the streaming daemons SCHED_FIFO.
case "$1" in
start)
	for irq in /proc/irq/[0-9]*; do
		n=${irq##*/proc/irq/}
		echo 1 > "$irq/smp_affinity" 2>/dev/null   # core 0 mask
	done
	# the DMA interrupt name is read from /proc/interrupts on the board (check: dma, axi-dmac, cf_axi)
	for n in $(grep -iE 'dmac|axi-dma' /proc/interrupts | cut -d: -f1 | tr -d ' '); do
		echo 2 > /proc/irq/$n/smp_affinity           # core 1 mask
	done
	for p in iiod maia-httpd; do
		pid=$(pidof $p) && chrt -f -p 90 $pid
	done
	;;
esac
```

Priority 90 for maia-httpd is a starting guess and can starve the web server; stage 4 decides the real values (`iiod` first, `maia-httpd` lower).

## 6. Test protocol and script (`/usr/bin/test_realtime_sdr.sh`, draft)

Gates for stage 1, 2, 3, 4: (a) `cyclictest -t1 -p98 -i250 -a1 -l100000 -m -h100` idle and under load, worst case below 50 us as the target;
(b) `stress-ng --cpu 1 --vm 1` pinned to core 0 while streaming on core 1; (c) `iio_readdev` at 2.5 and 10 MS/s over Ethernet (`192.168.3.1`) and USB (`192.168.4.1`), no
overflow and `iq_continuity` clean; (d) AD9361 2x2 tuning, fast-lock profile writes and web UI response time via the existing hwtest scripts (`suite.sh`, 70 checks).

```sh
#!/bin/sh
# test_realtime_sdr.sh: run on the Pluto+ (needs rt-tests and stress-ng in the image)
LOG=/tmp/rt_$(date +%Y%m%d_%H%M%S); mkdir -p $LOG
uname -a > $LOG/uname.txt; cat /proc/cmdline >> $LOG/uname.txt
echo "== cyclictest idle";   cyclictest -t1 -p98 -i250 -a1 -l100000 -m -h100 -q > $LOG/cyc_idle.txt
echo "== cyclictest loaded"
taskset -c 0 stress-ng --cpu 1 --vm 1 --vm-bytes 64M --timeout 400s &
SP=$!
iio_readdev -u local: -b 262144 -s 100000000 cf-ad9361-lpc voltage0 voltage1 > /dev/null 2> $LOG/stream.txt &
RP=$!
cyclictest -t1 -p98 -i250 -a1 -l100000 -m -h100 -q > $LOG/cyc_load.txt
wait $RP; echo "iio_readdev exit $?" >> $LOG/stream.txt
kill $SP 2>/dev/null
grep -i -E "overflow|underflow|drop|error" $LOG/stream.txt && echo "STREAM PROBLEMS" || echo "stream clean"
grep "Max Latencies" $LOG/cyc_*.txt
echo $LOG
```

Host side: `iio_readdev -u ip:192.168.3.1 -b 262144 -s <samples> cf-ad9361-lpc voltage0 voltage1` at the sample rates 2.5 and 10 MS/s (set with `iio_attr`), then compare
sample counts and run `tools/iq_continuity`. The exact `iio_readdev`/`iio_rwdev` options are checked against the libiio 1.0 tools before the first run.

## 7. Build and SD image commands (Pluto+)

```bash
cd ~/code/tezuka_fw-dev
export BR2_DL_DIR=/home/mb/code/tezuka_fw-all/buildroot/dl
source sourceme.first
./build.sh -j16 plutoplus                      # full image, about 22 min from scratch
# kernel only, after changing the pin or config:
make -C buildroot O=output/plutoplus linux-dirclean linux
make -C buildroot O=output/plutoplus           # repack the images
# known traps: board-fpga-dirclean board-fpga for the Pluto+ post-image; maia-kmod-dirclean after a kernel version change
cp -r output/plutoplus/images/sdimg ~/tezuka-review-v0.3.23/hwtest/known_good/sdimg-<name>   # keep the image
cd ~/tezuka-review-v0.3.23/hwtest && HOST=192.168.3.1 NOPOWER=1 ./sd_write.sh known_good/sdimg-<name>
```

`sd_write.sh` writes the card through the SD mux and checks the `/boot` checksums on the board after reboot. The line "FAT-fs Volume was not properly unmounted" is the known SD-swap notice.

## 8. Rules that stay

Pluto+ SD only; never cross-board images; keep the known-good images before overwriting; verify `uname -r`, `/opt/VERSIONS`, dmesg against the known lines and
`/boot` checksums after every SD write; ask before every push; the Pluto is flashed, ejected and power-cycled by the user; U-Boot work only with a UART console and a recovery path.

## 9. Stage 1 result: baseline on the current kernel (2026-10-25, hardware-measured)

Pluto+ running the `g32c3` SD image (kernel 6.12.114, `PREEMPT=y`, HZ 1000, `cpuidle.off=1`, normal services running: maia-httpd, iiod, classifier, mosquitto,
api_controller). `cyclictest` 2.80 and `stress-ng` 0.21.02 were cross-built in `output/plutoplus` (`BR2_PACKAGE_RT_TESTS`, `BR2_PACKAGE_STRESS_NG`; both exist in
Buildroot 2026.08.1) and copied to `/tmp` on the board with `libnuma.so.1`; the image was not changed. `cyclictest -t1 -p98 -i250 -a1 -m`, thread on core 1.

| Case | Min / Avg / Max latency (us) |
|---|---|
| Idle, 100000 loops (25 s), two runs | 11 / 25 / 232 and 11 / 29 / 220 (78 of 100000 loops above 100 us in the histogram run) |
| While streaming 2.5 MS/s over Ethernet (host `iio_readdev`, 5 s) | 11 / 38 / 17457 |
| Same, plus `stress-ng --cpu 1 --vm 1 --vm-bytes 64M` on core 0 | 11 / 47 / 16794 |
| While streaming 10 MS/s | 11 / 98 / 32904 |
| Same, plus stress-ng on core 0 | 12 / 109 / 19189 |

Streaming drop check (Pluto TX cyclic tone, whole cycles in the TX buffer, to Pluto+ RX, host `iio_readdev -b 262144`, tone SNR 67 to 73 dB): all samples delivered and
wall time equals real time (5.06 to 5.11 s for 5 s) at 2.5 and 10 MS/s, idle and loaded. Block-phase analysis (512-sample blocks): per-block increment standard deviation 0.006 to 0.007 rad,
0 outliers above 0.4 rad, amplitude min/median 0.98 to 0.99, i.e. no dropped buffer (a dropped 262144-sample buffer would show as a phase step). Script: `stream_rt.py` (scratchpad, not in the repo).

Reading (the explanation of the millisecond spikes below is WRONG, see section 11: the test thread shared core 1 with iiod at SCHED_RR 99): the existing kernel keeps zero drops at 2.5 and 10 MS/s over Ethernet even with core 0 loaded. Scheduling latency is the problem: tens of microseconds on average, 220 to 232 us worst case when idle,
and 17 to 33 ms worst case while streaming over Ethernet (the stream path, not the stress load, causes it). Target of the RT work: worst case below 50 us idle, and a large cut of the millisecond spikes while streaming.
Not measured yet: USB streaming, local (on-board) streaming at higher rates, longer runs, `NO_HZ_FULL` or core isolation. The 17 to 33 ms spikes should be re-checked with a longer run and with the stream
limited to one `iiod` thread before judging RT, since one 5 s run per case is a small sample.

### Stage 1b: local streaming at higher rates (2026-10-25, hardware-measured)

Same board and image. `iio_readdev -u local: -b 262144` on the Pluto+ itself, output to a tmpfs file (25 M samples per case), then copied to the host for the tone/phase-step check
(Pluto TX cyclic tone about 450 kHz, tone SNR 66 to 68 dB); `cyclictest -t1 -p98 -i250 -a1` ran on core 1 for the whole window (about 10 s, the stream is only 0.4 to 3 s of it), load = `stress-ng` on core 0. Script `stream_local.py` (scratchpad).

| Rate | Load | Read time vs signal time | Phase-step outliers (>0.4 rad) | cyclictest max (us) |
|---|---|---|---|---|
| 10 MS/s | none / core 0 | 2.94 / 3.38 s vs 2.50 s | 0 / 0 | 265 / 207 |
| 20 MS/s | none / core 0 | 1.92 / 3.30 s vs 1.25 s | 16 / 76 | 264 / 194 |
| 30.72 MS/s | none / core 0 | 1.82 / 2.81 s vs 0.81 s | 55 / 84 | 220 / 248 |
| 61.44 MS/s | none / core 0 | 1.72 / 3.11 s vs 0.41 s | 80 / 85 | 238 / 241 |

Reading: all samples are delivered, but at 20 MS/s and above the read takes 1.5 to 7 times real time and the tone has phase steps, i.e. buffers are dropped. This chain is limited by the
Cortex-A9 copying 80 to 245 MB/s through the tool and a tmpfs write, so it shows the ceiling of this measurement path and not of the DMA/FPGA path. A drop test at those rates needs a consumer that does not copy
(for example the maia-hdl capture path or a small on-board C checker). 10 MS/s is clean with and without core-0 load.
The scheduling latency during local streaming stays at 190 to 265 us worst case, against 17 to 33 ms during Ethernet streaming (section 9): the millisecond spikes come from the network path
(GEM interrupts, softirq, `iiod` socket work), not from the DMA stream itself. Both runs still miss the 50 us target, so RT is needed in both cases. Caveat: `cyclictest` ran over the whole
window, not only while streaming.

## 10. Stage 2 result: PREEMPT_RT on 6.12.114 (2026-10-25, hardware-measured)

Kernel: `~/code/linux-rt`, branch `tezuka/6.12.114-rt` = `678c4de70fdf` + one commit `fcde289` (unmodified `patch-6.12.111-rt21.patch` from
kernel.org/pub/linux/kernel/projects/rt/6.12/; it enables `ARCH_SUPPORTS_RT` for 32-bit ARM and applies cleanly on 6.12.114). Local only, not pushed.
Build: `configs/plutoplus_maiasdr_defconfig` in `dev/next` (uncommitted edit) with `file://` tarball of that branch, fragment `board/tezuka/plutoplus/kernel/fragment/rt.config`
(`PREEMPT_RT=y`, `EXPERT`, `CPU_FREQ` and `COMPACTION` off) and `rt-tests`/`stress-ng` in the image. Full Pluto+ build about 26 min. Image saved as `known_good/sdimg-rt21`.
Written to the Pluto+ SD with `sd_write.sh` (`/boot` checksums match). Rollback: `known_good/sdimg-fresh-g32c3`.

Boot check (hardware): `Linux 6.12.114-rt21 #1 SMP PREEMPT_RT`, `CONFIG_PREEMPT_RT=y`, libiio 1.0.0, iiod and maia-httpd running, dmesg only the two known lines
(spi-nor ear reg, cpuidle), no BUG/lockdep/sleeping-function messages. The full RF suite and the TX tone check were NOT rerun on this image yet.

| Case | Non-RT (stage 1) max latency (us) | RT 6.12.114-rt21 max latency (us) |
|---|---|---|
| Idle, 100000 loops | 232 / 220 | 65 / 73 / 103 (avg 22 to 23) |
| Local streaming 10 MS/s, idle / core-0 load | 265 / 207 | 92 / 105 |
| Local 20 MS/s | 264 / 194 | 65 / 102 |
| Local 30.72 MS/s | 220 / 248 | 106 / 92 |
| Local 61.44 MS/s | 238 / 241 | 80 / 78 |
| Ethernet streaming 2.5 MS/s, idle / loaded | 17457 / 16794 | 23817 / 23308 |
| Ethernet streaming 10 MS/s, idle / loaded | 32904 / 19189 | 24382 / 43026 |

Drops: Ethernet at 2.5 and 10 MS/s still 0 outliers (idle and loaded). Local streaming: 10 MS/s idle clean, 10 MS/s loaded 3 outliers, 20 MS/s idle 3 (was 16),
loaded 79 (was 76), 30.72 and 61.44 MS/s as before (about 50 to 85), i.e. the same copy-path limit as in stage 1b, so the drop numbers above 10 MS/s still say nothing about the DMA path.

Reading (the Ethernet-spike part is superseded by section 11): RT cuts the worst case about 2.5 to 3.5 times (idle 220 to 232 down to 65 to 103 us) and the local streaming spikes to under 110 us, but it does NOT reach the 50 us target and it does not
touch the 17 to 43 ms spikes while streaming over Ethernet. Those spikes are therefore not ordinary scheduling delay. Suspects, not yet tested: long non-preemptible or interrupt-off sections in
the network/DMA-sync path (the Zynq PL310 outer-cache maintenance on large buffers is a known source of multi-millisecond latency), or the GEM interrupt path. Next measurement: `cyclictest -b` with
the ftrace `irqsoff`/`preemptoff` tracers, or `wakeup_rt`, during Ethernet streaming to find the code path.

## 11. Cause of the millisecond spikes while streaming over Ethernet (2026-10-25, hardware-measured)

Diagnostic image `known_good/sdimg-rt21-trace` (RT kernel plus `FTRACE`, `FUNCTION_TRACER`, `IRQSOFF_TRACER`, `PREEMPT_TRACER`, `SCHED_TRACER` via
`board/tezuka/plutoplus/kernel/fragment/trace.config`, uncommitted). With 10 MS/s Ethernet streaming running: the `irqsoff` tracer's longest section was 359 us and the `preemptoff` tracer's 538 us, so
the kernel does not hold interrupts or preemption off for milliseconds (both numbers include tracer overhead). The `wakeup_rt` tracer reported its worst wakeup for `rw_thd` (a thread of `iiod`, `policy:2` = SCHED_RR, `rt_prio:99`)
on CPU 1, not for `cyclictest`.

Cause: `board/tezuka/common/overlay_base/etc/init.d/S23udc:176` starts iiod as `chrt -r 99 taskset -c 1 iiod ...`, i.e. all iiod threads (`usbd_main_thd`, `net_main_thd`, `rw_thd`, avahi) run SCHED_RR 99 pinned to core 1.
My `cyclictest -p98 -a1` ran on the same core at a lower priority, so every burst of streaming work in iiod (up to tens of ms) preempted it. That was a test artifact, not kernel latency. Stage 1 and stage 2 figures
for Ethernet streaming (17 to 43 ms) measure iiod, not the kernel.

Re-measure with `cyclictest -p98 -a0` (core 0, where all interrupts and softirq threads run; iiod is not there), Ethernet streaming 2.5 and 10 MS/s, idle and with `stress-ng` on core 0:

| Image | Max latency (us), 2.5 idle / 2.5 load / 10 idle / 10 load |
|---|---|
| Non-RT `g32c3` (6.12.114, PREEMPT) | 1893 / 3923 / 3827 / 2541 |
| RT 6.12.114-rt21 (clean image `sdimg-rt21`) | 98 / 194 / 153 / 175 |
| RT with tracing compiled in (`sdimg-rt21-trace`) | 160 / 255 / 176 / 160 |

Idle without streaming on the RT image, core 0: 10 / 22 / 93 (min/avg/max). Ethernet streaming at 2.5 and 10 MS/s: 0 dropped buffers on all images. So PREEMPT_RT cuts the worst case about 20 times on the core
that handles the network (ms down to under 200 us), but 50 us is still not reached; the remaining 100 to 250 us are the next thing to trace (`wakeup_rt` with `cyclictest -a0` as the traced task, or the `preemptoff` trace taken on core 0).
Open design point: iiod at RR 99 on core 1 means a real-time application on core 1 must run at 99 or accept preemption by iiod; stage 4 (core isolation) has to decide where iiod and the DSP threads live.

## 12. Functional check of the RT image (2026-10-25, hardware-measured)

Pluto+ on `sdimg-rt21` (6.12.114-rt21 PREEMPT_RT, no tracing), Pluto on the non-RT `g32c3` firmware.

- Full RF suite (`session-2026-10-17-dashboard/scripts/suite.sh`, log `suite_rt21.log`): 69 ok, 1 FAIL, 30 sections, 30 of 30 settings restored, 0 InvalidStatus, 0 Traceback (non-RT reference: 70 ok, 0 FAIL).
  The FAIL is in the first section (Pluto RX, Pluto+ TX, 2.5 MS/s, 205 kHz CW): `raw_vs_mag_log_corr` 0.80 against 0.999 normally, with the right peak bin but the I/Q peak on two adjacent bins (2465 and 2466).
  Rerun six times with the identical command: 6 of 6 ok (0.9987 to 0.9999), the tone moves between bins 2465 and 2467 from run to run. Not reproduced, cause not proven; a tone sitting on a bin boundary is the likely
  explanation, but this is the second unexplained one-off FAIL of this kind (the first was on the kernel-pin step) and the RT kernel is not cleared as the cause on one 6-run sample.
- TX tone check, both directions: Pluto TX to Pluto+ RX (RT) 200.4 kHz at 72 to 73 dB, datasel 0x2 while writing, 0x0 after stop (LO leakage 46 to 47 dB), two cycles; Pluto+ (RT) TX to Pluto RX 62 dB, after stop 33 dB, datasel 0x0.
- Both boards: Ethernet streaming 2.5 and 10 MS/s, 0 dropped buffers (section 11).
Not done: an RT image on the original Pluto, USB gadget streaming, long soak.

## 13. How to rebuild the RT test image

- Kernel: `~/code/linux-rt` (branch `tezuka/6.12.114-rt`, local, commit `fcde289`). Tarball: `git -C ~/code/linux-rt archive --format=tar.gz --prefix=linux-rt-fcde289/ -o ~/code/linux-rt-fcde289.tar.gz HEAD`.
- Config: `configs/plutoplus_rt_defconfig` (same as `plutoplus_maiasdr_defconfig` plus the fragment `board/tezuka/plutoplus/kernel/fragment/rt.config`, `rt-tests` and `stress-ng`; the kernel pin is the local tarball above, so
  this config only builds on a machine that has it). It is not listed in `boards.json`. Build: `source sourceme.first; make -C buildroot O=$PWD/output/plutoplus_rt plutoplus_rt_defconfig; make -C buildroot O=$PWD/output/plutoplus_rt -j16`
  (if the post-image fails on `system_top.bit`: `board-fpga-dirclean board-fpga`, then `make` again). Add `board/tezuka/plutoplus/kernel/fragment/trace.config` to the fragment list for the ftrace diagnostic image.
- Images used in this document: `known_good/sdimg-rt21` (RT), `known_good/sdimg-rt21-trace` (RT with tracers), `known_good/sdimg-fresh-g32c3` (non-RT reference and rollback).
