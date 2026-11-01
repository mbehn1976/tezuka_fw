# Linux 7.x and PREEMPT_RT on the Pluto+ (plan, state 2026-10-25; RT track results in section 16, 2026-10-29; 7.3-rc7 bring-up in section 17, 2026-10-30)

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

## 14. Soak comparison RT against non-RT (2026-10-25, hardware-measured)

Same script on both kernels (Pluto+ under test, Pluto non-RT as the link partner): 15 minutes of 5 s Ethernet streaming runs at 10 MS/s (53 iterations; `cyclictest -p98 -a0` and `stress-ng` on core 0 on the board;
block-phase outlier check on the received tone), then 6 minutes of repeated `rf_iq_check.py --fs 2500000` (Pluto RX, the check that failed once in the suite). A power glitch in the room reset both boards during the first
non-RT attempt (void; the Pluto came up in the U-Boot USB download gadget and needed a power cycle); the numbers below are from the repeat.

| | Non-RT 6.12.114 (`g32c3`) | RT 6.12.114-rt21 |
|---|---|---|
| Iterations, incomplete reads | 53, 0 | 53, 0 |
| Worst `cyclictest` max, core 0 | 10084 us | 551 us (9 iterations above 200 us) |
| Phase-step outliers (>0.4 rad), total | 6 | 21 (17 of 53 iterations) |
| CW-check repeat (`cw 205000 Hz`, 6 runs) | 6 ok, 0 FAIL | 5 ok, 1 FAIL |
| Full suite | 70 ok, 0 FAIL (gb6c3, same sources) | 69 ok, 1 FAIL (the same check) |

Reading: PREEMPT_RT lowers the worst-case latency about 18 times but, in this test, goes with more tone discontinuities and the only CW-check failures seen so far (two, both on the RT image, none on non-RT in 6 + 70 runs).
The samples are small and the outliers are not yet shown to be dropped DMA buffers, so this is a lead, not a verdict. Next: find where the outliers sit (buffer boundaries of 262144 samples would point at dropped blocks),
check the iiod/DMA ring behaviour under RT (kernel buffer count, block size), and repeat with more runs and with `cyclictest` stopped (to rule out the test load itself).

### 14b. Where the outliers sit (RT image, 2026-10-25, hardware-measured)

Same setup as above (Ethernet 10 MS/s, `iio_readdev -b 262144`, `cyclictest -p98 -a0` and `stress-ng` on core 0), 50 loaded iterations of 5 s, outlier = block-phase step above 0.4 rad.
Result: 10 outliers in 50 iterations (8 or 9 iterations affected; an earlier run of 12 loaded plus 8 unloaded iterations had 0), and all 10 sit exactly on a multiple of 262144 samples (distance 0 in every case;
for example sample 42729472 = 163 x 262144, 2097152 = 8 x 262144, seen twice). The step sizes vary (-2.47 to 3.1 rad), which fits one to a few whole buffers missing (not verified, the data was not kept).
Conclusion: the outliers are whole buffers lost or damaged, not a TX glitch or drift. Rate: RT 21 of 53 iterations (first soak) and 10 of 50 (this run), non-RT 6 of 53 (location not recorded).
Earlier local (on-board) 10 MS/s tests under load had 3 outliers on RT and 0 on non-RT, so the loss is not specific to the Ethernet path. Not yet separated: the effect of the test load itself
(`cyclictest` wakes 4000 times per second at priority 98 on the core that also runs the network interrupt threads, `stress-ng` on the same core) from the effect of the RT kernel.

### 14c. Three-way test: which load causes the lost buffers (RT image, 2026-10-25, hardware-measured)

Ethernet 10 MS/s, 25 iterations of 5 s per case, same outlier check; script `outlier_3way.py` (scratchpad). All outliers sit exactly on 262144-sample boundaries.

| Load on core 0 | Outliers in 25 iterations |
|---|---|
| none | 2 |
| `stress-ng` only | 4 |
| `cyclictest -p98 -i250` only | 7 |
| both (50-iteration run above) | 10 in 50 |

Reading: buffers are also lost with no test load at all (2 of 25), so the load is not the whole cause; `cyclictest` raises the rate the most. The counts are small, and the same three cases have not yet been run on the non-RT kernel
(the only non-RT figure is 6 outliers in 53 iterations with both loads), so it is still open whether RT loses more than non-RT. Next: the same three cases on `g32c3`, then the kernel/iiod side (block count of the iiod kernel buffer, `iiod -n 3`,
DMA ring depth, whether the host-side `iio_readdev -b 262144` with libiio 1.0 uses few blocks) to see where a buffer can be dropped.

### 14d. Same three cases on the non-RT kernel (2026-10-25, hardware-measured) and what it means

Non-RT `g32c3`, Ethernet 10 MS/s, 25 iterations of 5 s per case, same check; all 11 outliers again sit exactly on 262144-sample boundaries.

| Load on core 0 | Non-RT outliers | RT outliers |
|---|---|---|
| none | 3 | 2 |
| `stress-ng` only | 5 | 4 |
| `cyclictest` only | 3 | 7 |
| Total of 75 iterations | 11 | 13 |

So the lost buffers are NOT caused by PREEMPT_RT: both kernels lose about one 262144-sample buffer in roughly one 5 s run out of seven, with or without test load. The soak counts (RT 21 of 53, non-RT 6 of 53) differ more than these
75-run totals do; with the small samples I treat RT as not worse until a longer run says otherwise. CORRECTION of earlier statements in sections 9 and 10 and in the first report: "0 dropped buffers at 10 MS/s over Ethernet" was based on four 5 s runs and is wrong.
10 MS/s over Ethernet is about 40 MB/s, close to the measured ceiling of about 50 MB/s (continuous only at 2.5 MS/s and below in this document's runs), so occasional whole-buffer drops there are what the earlier ceiling
measurement predicts. Next, to confirm: repeat the check at 5 MS/s and 7.5 MS/s (expected clean) and look at the iiod/TCP side (`iiod -n 3`, socket buffers).

### 14e. Rate dependence (RT image, Ethernet, no extra load, 30 iterations of 5 s per rate, 2026-10-25, hardware-measured)

| Rate | Outliers in 30 iterations | On a 262144-sample boundary |
|---|---|---|
| 5 MS/s | 2 | 2 |
| 7.5 MS/s | 5 | 5 |
| 10 MS/s | 2 | 2 |

The loss rate does not rise with the data rate between 5 and 10 MS/s (about 20 MB/s to 40 MB/s), so the "close to the Ethernet ceiling" explanation in 14d is NOT supported; treat that sentence as refuted.
Whole-buffer losses occur at 5 MS/s too, on both kernels. Candidates not yet tested: the host side (libiio 0.26 `iio_readdev`, NIC), iiod/TCP, the kernel DMA block queue (a block not requeued in time), the transport itself.
Discriminating test: the same 5 MS/s check over USB (`192.168.4.1`) and on the board itself (`iio_readdev -u local:` into tmpfs), 30 iterations each, then a libiio 1.0 host client.

### 14f. Transport comparison and the pre-upgrade firmware (2026-10-25, hardware-measured)

Pluto+ at 5 MS/s, 30 iterations of 5 s, no extra load, Pluto non-RT as the TX partner, outlier check as above (every outlier sits on a 262144-sample boundary in all cases).

| Firmware on the Pluto+, client, transport | Outliers (iterations) |
|---|---|
| RT 6.12.114-rt21, iiod 1.0.0, libiio 0.26 client, USB (192.168.4.1) | 106 (30) |
| RT, board-local `iio_readdev -u local:` into tmpfs | 0 (30) |
| RT, libiio 1.0.0 client (`iio_rwdev`, host build of the same release), Ethernet | 0 (30) |
| RT, libiio 0.26 client, Ethernet | 4 (30) |
| Pre-upgrade `sdimg-k2-newdash13` (6.12.114 non-RT, iiod 0.26), 0.26 client, Ethernet | 0 (30) |
| Same pre-upgrade firmware, 0.26 client, USB | 96 (30) |
| Same pre-upgrade firmware, 0.26 client, Ethernet, 10 MS/s | 14 outliers in 8 of 40 iterations |

Reading: the kernel/DMA/iiod-independent local path is clean, so the receiver chain on the board is not dropping data. Over the network the host/iiod path with the 0.26 client loses whole 262144-sample buffers on every firmware tried,
including the pre-upgrade one (about one 5 s run in five at 10 MS/s), so this is NOT a regression of the libiio 1.0 upgrade and NOT caused by PREEMPT_RT. USB is much worse and equally bad before and after the upgrade. The libiio 1.0 client was clean in 30 runs at 5 MS/s;
it has not yet been run at 10 MS/s. The earlier statements in this document that Ethernet at 10 MS/s is drop-free are wrong (sections 9, 10, 11); the measured ceiling note in memory (continuous at 2.5 and 10 MS/s) came from short runs.
Host used: libiio 0.26 tools from the distribution, libiio 1.0.0 tools built from the Buildroot-downloaded `libiio-1.0.0.tar.gz` into the scratchpad.

### 14g. libiio 1.0 client against the 0.26 client at 10 MS/s (RT image, Ethernet, no extra load, 40 iterations of 5 s each, 2026-10-25, hardware-measured)

| Client | Outliers (all on a 262144-sample boundary) |
|---|---|
| libiio 1.0.0 `iio_rwdev` (host build) | 4 |
| libiio 0.26 `iio_readdev` | 6 |

The 1.0 client, clean in 30 runs at 5 MS/s, loses buffers at 10 MS/s as well, at a rate like the 0.26 client. So the loss is not a property of the 0.x protocol or of the client version. What is established: the on-board path is clean (0 of 30 at 5 MS/s);
over Ethernet both client versions lose whole 262144-sample buffers at 10 MS/s (about one 5 s run in seven to ten), with RT and non-RT kernels and also with the pre-upgrade firmware; USB loses far more at 5 MS/s. Likely mechanism, not proven: a brief stall of the network consumer
(TCP, host or iiod thread) lets the kernel DMA buffer queue overrun, which drops whole blocks. Candidate fixes to test: more kernel buffers in iiod/the client (block count), larger socket buffers, a larger transfer size.

## 15. Next steps (as of 2026-10-25, in recommended order)

1. **Decide the track.** (a) Network buffer losses, (b) RT latency tail and core isolation, (c) Linux 7.3. They are independent; (a) affects every user of the firmware, (b)/(c) only the RT goal.
2. **(a) Network buffer losses** (whole 262144-sample buffers lost over Ethernet at 5 to 10 MS/s and over USB at 5 MS/s, all firmware, on-board path clean).
   - Find out how many kernel blocks iiod and the client use. Client side: libiio 0.x has `iio_device_set_kernel_buffers_count()`, libiio 1.0 takes the block count in `iio_buffer_create_stream()`; the stock tools may not expose it, so use a small
     C or pylibiio test with 4, 8, 16 blocks at 10 MS/s (30 runs each, `outlier_transports.py` pattern in `session-2026-10-25-rt/scripts`). Check iiod's own setting (`iiod --help` on the board; the start line is in `S23udc:176`).
   - Try bigger socket buffers (`net.core.rmem_max`/`wmem_max`, `net.ipv4.tcp_rmem` on host and board), the GEM ring size (`ethtool -g eth0` on the board), host NIC offloads and CPU governor, and a direct cable/other host to rule out the laptop.
   - Separate stalls: log timestamps of each `iio_readdev` buffer to see whether a loss follows a long read gap.
   - USB is far worse (about 100 outliers per 30 runs at 5 MS/s); check it separately (USB 2.0 throughput, CDC-NCM vs RNDIS on the host side).
   - Gate: 0 outliers in 100 runs at 10 MS/s with the chosen setting, tone check at the end.
3. **(b) RT latency tail.** Boot `known_good/sdimg-rt21-trace`; copy `session-2026-10-25-rt/scripts/trace_board.sh` to the board and change `-a1` to `-a0`. Run `sh /tmp/trace_board.sh preemptoff 30` and `irqsoff` during 10 MS/s Ethernet streaming; for `wakeup_rt` the traced task is the highest-priority RT task, which is iiod (RR 99),
   so either stop streaming or run `cyclictest` at SCHED_FIFO 99 and look at its wakeups. Goal: find the code behind the 100 to 250 us worst case on core 0 (idle max 65 to 103 us, target 50 us).
4. **(b) Stage 4: core isolation.** Decide where iiod and the DSP threads live (iiod is pinned to core 1 at RR 99 in `S23udc:176`). Try `isolcpus=1 nohz_full=1 rcu_nocbs=1` on the SD variants in `uboot-env.txt`, `S99realtime` (draft in section 5), IRQ affinity (read the DMA IRQ names from `/proc/interrupts` first).
   Re-measure idle and streaming latency with `cyclictest` on the isolated core; keep the web UI responsive (maia-httpd and mosquitto stay on core 0).
5. **Open check on the RT image.** The CW-check FAIL (Pluto RX, Pluto+ TX, 2.5 MS/s, 205 kHz): run 30 repeats each on RT and non-RT to see whether the 1-in-6 rate on RT is real (non-RT 0 of 6 so far). Also the full suite once more after any RT config change.
6. **Not done yet on RT:** the original Pluto (needs an RT image for it; the user flashes and ejects), the USB gadget (mass storage, network) under RT, an overnight soak, the DAC tone fix under streaming load.
7. **(c) Linux 7.3.** Wait for the final 7.3 tag (newest was v7.3-rc7). Only then start stage 3 of section 3: branch from the tag in `mbehn1976/linux`, forward-port the ADI drivers and our six patches (ADI has no 7.x Zynq tree), fix compile errors per file, `make dtbs_check` on `zynq-plutoplus.dts`. Worth it only if RT on 6.12 proves insufficient or the user wants the newer kernel.
8. **Housekeeping and decisions.** Nothing here is pushed. Before any push: where the RT kernel branch lives (fork `mbehn1976/linux`, or an F5OEO repo), whether `configs/plutoplus_rt_defconfig` stays a local-tarball config or gets a hosted pin. The earlier upstream items (F5OEO PR, ADI issue, kernel hosting) are in `HANDOVER.md` section 6 and
   the memory file `project_upgrade_summary.md`. Also correct the old "10 MS/s Ethernet is drop-free" statements wherever they were made public (none were posted upstream so far).

### 14h. Block count fix test (RT image, libiio 1.0 client over Ethernet, 10 MS/s, 30 runs of 5 s per setting, shuffled order, no extra load, 2026-10-28, hardware-measured)

Client: host `iio_rwdev` of libiio 1.0.0 with the stream block count taken from an environment variable (the stock tool hard-codes 4 in `iio_buffer_create_stream(buffer, 4, ...)`; patched copy saved as `session-2026-10-25-rt/scripts/iio_rwdev_nb_blocks.c`). Block size 262144 samples.

| Blocks | Runs with outliers | Outliers (all on 262144 boundaries) |
|---|---|---|
| 4 (default) | 2 of 30 | 3 |
| 8 | 0 of 30 | 0 |
| 16 | 0 of 30 | 0 |
| 32 | 0 of 30 | 0 |

Reading: more kernel/stream blocks remove the whole-buffer losses in this test. Zero losses in 90 runs at 8 to 32 blocks against about 7 percent of runs at 4 blocks (the rate seen in all earlier tests) is unlikely to be chance (about 1 in 700), but 30 runs per setting is small.
Mechanism fits the earlier hypothesis: a short stall of the network consumer overruns the 4-block queue. Still to do: confirm with 100 or more runs, check 12.5/15/20 MS/s (earlier "drops above 12 MS/s"), USB at 5 MS/s, and a 0.26 client with `iio_device_set_kernel_buffers_count()`.
Practical consequence: the block count is chosen by the client, so stock clients (GNU Radio, SDR++, pyadi-iio) keep their own default; our own apps (iio_ws_proxy, zynqrx, pluto_rx, cpdetect) can use more blocks. Whether iiod can enforce a larger minimum is not checked.

### 14i. Confirmation of the block count fix (RT image, libiio 1.0 client, Ethernet, 10 MS/s, 100 runs of 5 s per setting, shuffled, 2026-10-28, hardware-measured)

| Blocks | Runs with outliers | Outliers (all on 262144 boundaries) |
|---|---|---|
| 4 (default) | 12 of 100 | 12 |
| 16 | 0 of 100 | 0 |

Together with 14h (8, 16 and 32 blocks: 0 of 90), the whole-buffer losses over Ethernet at 10 MS/s disappear with 8 or more blocks. Zero of 100 at 16 blocks against 12 percent at 4 blocks is not chance (about 1 in 300000). Tested with the libiio 1.0 client only, on the RT kernel;
the same cause is expected on the non-RT kernel and with the 0.26 client (same loss rates there), which has not been tested with a larger count.

### 14j. Block count at higher rates (RT image, libiio 1.0 client, Ethernet, 20 runs of 5 s per cell, shuffled, 2026-10-28, hardware-measured)

| Rate | 4 blocks | 16 blocks | 32 blocks |
|---|---|---|---|
| 12.5 MS/s | 114 outliers, 20 of 20 runs | 2 outliers, 2 of 20 runs | 0 outliers, 0 of 20 runs |
| 15 MS/s | 2665, 20 of 20 | 442, 20 of 20 | 228, 20 of 20 |
| 20 MS/s | 5088, 20 of 20 | 2209, 20 of 20 | 2004, 20 of 20 |

(an outlier is one lost 262144-sample buffer boundary, all of them sit on a boundary; a 5 s run at 15 MS/s holds about 286 buffers, at 20 MS/s about 380).
Reading: more blocks push the clean range from about 7.5 MS/s (4 blocks, with sporadic losses already at 5 to 10 MS/s) to 12.5 MS/s (32 blocks, 0 of 20; 16 blocks nearly clean). At 15 MS/s and above every run loses buffers whatever the block count, about 11 per run at 32 blocks against 133 at 4 blocks;
that matches the measured Ethernet throughput limit of roughly 50 MB/s (12.5 MS/s is 50 MB/s of 16-bit I/Q), where more blocks can only absorb bursts, not a sustained excess. So the practical Ethernet ceiling with this setup is about 12.5 MS/s with 32 blocks; faster rates need the data to stay on the board
(local processing, maia-hdl) or a faster link. Not tested: the 0.26 client with a larger count, USB (far worse at 5 MS/s), non-RT kernel with 16/32 blocks.

## 16. RT track summary: latency tail, core isolation, iiod placement (2026-10-28 to 2026-10-29, hardware-measured on the Pluto+)

All numbers: Pluto+ on SD, kernel 6.12.114-rt21, `cyclictest -t1 -i250` (priority 98 or 99), libiio 1.0 client over Ethernet at 10 MS/s with 32 blocks unless stated.
Raw logs and scripts: `hwtest/session-2026-10-25-rt/` (`NEXT_STEPS.md` has the chronological log, `scripts/`, `logs/`, `traces/`). Nothing here is pushed.

### 16a. Where the idle tail comes from
- `irqsoff` / `preemptoff` tracers on core 0, idle, function tracing OFF (`options/function-trace=0`): worst windows 61 us (irqsoff) and 86 us (preemptoff), both inside the context switch, not in a driver.
  With function tracing ON irqsoff reads 464 us, which is tracer cost, not the system.
- The tracers perturb the system under streaming (an irqsoff run stalled `cyclictest` for 41 ms). `wakeup_rt` costs about 70 us per wakeup because it always dumps a stack (`cyclictest` average 88 us instead of 18 us),
  and an event trace (sched, irq, hrtimer) added 70 to 90 us even on an idle core. **ftrace cannot size a tail of about 50 us on this Cortex-A9**; use untraced `cyclictest` numbers for sizes and traces only for "what runs".
- `cyclictest -a0` under the 10 MS/s stream, no tracer: max 210 to 436 us on core 0 (iiod's RR 99 threads share it).
- `wakeup_rt` x5 under streaming on core 0: the iiod RR 99 threads (`net_client_thd`, `writer-task`, `buffer-*`) wait 51 to 81 ms behind each other, `ktimers/1` is starved for 81 ms (`sched_rr_timeslice_ms=100`).
  Lowering iiod to SCHED_FIFO 40 made core 0 worse (19 to 51 ms) and was reverted.

### 16b. Core isolation (`isolcpus=1 irqaffinity=0` on the sdboot_ram bootargs line; image `known_good/sdimg-rt21-iso`)
- iiod threads moved to core 0 at runtime, `cyclictest -p99 -a1` on core 1: idle 120 s max 44 us (avg 15); under the 10 MS/s stream 300 s max 46 us. A core-0 reference run gave 50 us. **The 50 us target is met when nothing network-related runs on the isolated core.**
- Kernel limits: `NO_HZ` is off and there is no `RCU_NOCB_CPU`, so `nohz_full`/`rcu_nocbs` need a kernel rebuild (not done).

### 16c. What a loaded core 0 does to the stream (iiod on core 0, `cyclictest` on core 1, synthetic stressors pinned to core 0)

| Stressor on core 0 | `cyclictest` core 1 max | Stream (20 rounds, 10 MS/s, 32 blocks) |
|---|---|---|
| `stress-ng --cpu 1` | 47 us | complete, but 45 to 65 lost-block outliers EVERY round, block gap median 42 to 52 ms (idle 26 ms) |
| `stress-ng --vm 1 --vm-bytes 32M` | 74 us | outliers every round (29 to 64), later rounds incomplete (see 16f) |
| cpu + vm together (1000 s) | 53 us | throughput halved, then the RX stream wedged (16f) |

Isolation protects the RT core, not the stream: iiod and the Ethernet IRQ share core 0 with the load.

### 16d. Placement test: iiod and the Ethernet IRQ on separate cores (CPU hog on core 0, `cyclictest` on core 1)

| iiod | Ethernet IRQ 31 | Stream | `cyclictest` core 1 max |
|---|---|---|---|
| core 1 | core 0 | CLEAN: 0 outliers in 20 rounds, gap median 26.3 ms | 109 us |
| core 0 (with the hog) | core 1 | 53 to 81 outliers per round, gap median 52 to 65 ms, RX wedge afterwards | 69 us |

With real housekeeping load on core 0 (stock services plus two browser-like `/waterfall` websockets and `/api` polling at 5 Hz from the host), iiod on core 1: 20/20 rounds clean, `cyclictest` max 108 us; with the CPU hog added 112 us.
Soak in this layout (iiod on core 1, `cyclictest` on core 1, websocket load): 87 min, 440 rounds, no loss in the middle of a stream (3 rounds with 1 to 2 outliers, all in the last block of the run = end-of-stream artifact), `cyclictest` max 91 to 139 us per 10 min segment (avg 25 to 27 us).

### 16e. Why iiod on core 1 costs 40 to 60 us, and the `S23udc` nproc bug
- Cause (traces, sizes from untraced runs): the `cyclictest` timer interrupt lands while the iiod writer thread is inside `sys_io_submit` -> `tcp_sendmsg` -> `tcp_gso_segment` -> `skb_segment` -> `kmalloc` -> `___slab_alloc`, which runs with interrupts off.
  iiod's TCP transmit path on the isolated core is what lifts the max from 44 to 47 us (iiod on core 0) to 80 to 112 us.
- iiod at SCHED_RR 99 on core 1 is unusable together with an RT task there: `cyclictest` max 63 ms and 88 ms (avg 120 us). The stream stays clean.
- **Start script (`S23udc`), fixed in `dbb9f48`.** It chose its iiod start line with `NB_CORE=$(nproc)`; under `isolcpus=1` `nproc` reports 1 (it honours the affinity mask), so the single-core branch ran: iiod started SCHED_OTHER and unpinned (the default mask excludes the isolated core, i.e. core 0).
  That accidentally gave layout A. All isolcpus tests above therefore used a SCHED_OTHER iiod that my scripts pinned at runtime with `taskset -p` (on boots without isolcpus the `chrt -r 99 taskset -c 1` branch runs; sections 11 and 14 are unaffected).
  The hazard was the reverse: a core-count-only fix would put SCHED_RR 99 iiod on the isolated core (63 to 88 ms starvation, above). The commit counts CPUs from `/proc/cpuinfo`, reads `/sys/devices/system/cpu/isolated`, and starts a plain iiod when cores are isolated (it stays on the housekeeping core through the default mask); boots without `isolcpus=` are unchanged.
  Hardware-verified on the Pluto+ (image `known_good/sdimg-rt21-s23fix-iso`: iiod and its threads on core 0, SCHED_OTHER; `known_good/sdimg-rt21-s23fix`, no isolcpus: threads on core 1, SCHED_RR 99).

### 16f. RX stream wedge (cause located: a stale iiod client session) and iiod deaths (cause unknown)
- RX wedge (twice): `Unable to dequeue block: Connection timed out (110)` on both the network and the local reader, iiod alive, AD9361 state and clocks fine; after the combined stressor load and after the placement variant with iiod on the hog's core. Seen in the isolcpus and pinned layouts. First thought to need an ssh `reboot`; see the next bullet for the real cure.
- RX wedge cause (2026-10-30, hardware-measured, `scripts/wedge_hunt_b.sh`, logs `logs/wedge_hunt_b*_2026-10-30`): reproduced on demand in placement variant B (iiod SCHED_OTHER on core 0 with a CPU hog, Ethernet IRQ on core 1, isolcpus image) three times (after 12, 101 and 33 rounds). At the stall iiod is alive with all threads sleeping normally, but the dead client's session threads (net_client_thd, writer, buffer enqueue and dequeue workers) are still there and iiod still holds an open IIO buffer on `cf-ad9361-lpc` (buffer disabled). A new local reader, which does not use iiod for its data, also times out. After `kill -9` of iiod the same reader works at once (normal 256 KiB DMA blocks, normal interrupt rate). So the wedge is a stale iiod client session that keeps the IIO buffer, not the hardware: the AD9361, its interface clock, the ADC core and the RX DMAC were fine, the TX DMAC worked, and the maia-sdr waterfall and raw capture kept delivering samples. Resetting the ADC core or toggling the DMAC enable bit cannot be credited, because those steps ran after the kill. Restarting iiod is enough; a plain `pkill iiod` (SIGTERM) did not end it in the first capture.
- Trigger (2026-10-30, hardware-measured, `scripts/wedge_hunt_t.sh` with the board-side monitor `scripts/trig_mon.sh`, logs `logs/wedge_hunt_t_2026-10-30`): the wedge starts when a new client connects while the previous session is still being torn down. At the stall the old connection sits in CLOSE_WAIT with its 5 session threads waiting and the IIO buffer fd still open, while the new session (16 threads, buffer enabled) gets no interrupts from the RX DMAC for 60 s or more. A normal teardown takes 2.3 to 2.9 s (once 19.9 s) and the harness leaves a 3 s gap, so a slow teardown, as when iiod is a normal task on a loaded core in layout B, lets the next connect overlap it. This points to a race or deadlock in the libiio 1.0.0 iiod session and buffer handling; the exact lock is not identified.
- Fast reconnects on the default image (2026-10-30, `scripts/fast_reconnect.sh`, logs `logs/fast_reconnect_2026-10-30`, hardware-measured, libiio 1.0 `iio_rwdev` at 10 MS/s with no gap): 400 idle cycles (slowest 0.14 s), 400 under `stress-ng --cpu 2` (0.34 s), 300 with the client SIGKILLed 0.2 to 1.2 s into a stream and the next one started at once (1.24 s), and the same 300 under `--cpu 2` (1.28 s). No hang, iiod alive, no BUG, WARN or hung-task line in dmesg. In the shipped mode teardown stays fast enough that the overlap does not wedge. Not tested: memory stress, or much slower teardown, in that mode.
- Not known: why the teardown hangs rather than only running slowly, and whether a newer libiio fixes it (layout B puts iiod as a normal task on the core with the hog). The default mode has not shown it in 1338 + 135 rounds or in 1400 fast reconnects. Not tested: a clean iiod restart through the init script followed by a network client (iiod holds the USB `ffs` endpoint, so a bare `iiod -D` is not equivalent).
- iiod died twice without a trace (board up for 11 h and 35 min; no oom/segv/dmesg line; the `local:` backend liveness check does not need iiod and hid it the first time).
  A foreground catcher (`scripts/iiod_wrap.sh`, core dumps on) saw no death in about 580 stream rounds / 2 hours of soaks, including the memory-stressor and event-trace cases that preceded the deaths. Not reproduced.
- Wedge hunt on the default image (2026-10-30, `scripts/wedge_hunt.sh`, hardware-measured): web UI load plus the 10 MS/s 32-block stream under escalating `stress-ng` (`--cpu 2`; `--cpu 2 --vm 2`; `--cpu 4 --vm 2 --hdd 1`, load average up to about 10.8): 135 rounds, 0 incomplete, 0 with lost blocks, iiod alive. No wedge, so the DMA and interrupt capture armed for the first stall never fired. Both wedges above came on isolcpus or pinned layouts where iiod ran SCHED_OTHER, not in the shipped mode, but this is not proven; the cause stays unknown.
- A memory stressor on core 0 breaks the stream (30 to 35 outliers per round) even with iiod on core 1; a CPU hog does not. That is DDR bandwidth, not scheduling.

### 16g. Conclusion: two layouts, no layout with both goals on this dual-core Zynq 7010

| Layout | `cyclictest` worst case | Stream at 10 MS/s over Ethernet | Use when |
|---|---|---|---|
| A. iiod and the Ethernet path on core 0, RT task on isolated core 1 | 43 to 48 us (idle and streaming, shipped `S23udc`, 16j); 47 to 53 us with a CPU hog, 74 us with a memory stressor | NOT clean with the web UI waterfall open (25 of 25 rounds with lost blocks, 16 to 58 per round, 16j) and not with a CPU hog | RT task needs under 50 us and nobody streams I/Q over Ethernet while the web UI is open (on-board processing only) |
| B. iiod on core 1 (SCHED_OTHER), housekeeping and Ethernet IRQ on core 0 | 80 to 139 us | clean under housekeeping load and a CPU hog (440-round soak) | the network stream matters; RT task tolerates about 100 to 140 us |

The RT kernel itself cuts the worst case from 220 to 265 us (non-RT) to 65 to 110 us; getting below 50 us needs layout A (or an RT task that does not share a core with the network transmit path).
Stream integrity at 10 MS/s needs 32 blocks (section 14h to 14j) in both layouts. Above 12.5 MS/s the Ethernet link itself is the limit (section 14j).

### 16i. Can the iiod transmit cost on core 1 be reduced with runtime settings? No (2026-10-29, hardware-measured)

Layout B (iiod SCHED_OTHER on core 1, Ethernet IRQ and services on core 0, `/waterfall` websocket load), `cyclictest -p98 -a1 -i250 -h 400` for 300 s per case (1.2 million samples), 25 stream rounds at 10 MS/s with 32 blocks per case, board checked for stray processes first.
The Pluto+ GEM has no TCP segmentation offload (`ethtool -k eth0`: `tx-tcp-segmentation: off [fixed]`), so the kernel segments in software (`skb_segment`, seen in the traces of 16e).

| Case | max (us) | avg (us) | samples >= 50 us | samples >= 80 us | stream |
|---|---|---|---|---|---|
| baseline | 126 | 26 | 0.99% | 800 | clean |
| `ethtool -K eth0 gso off` | 112 | 28 | 7.60% | 672 | clean |
| `tcp_limit_output_bytes` 1 MB -> 64 KB | 94 | 25 | 0.89% | 49 | clean |
| gso off + 64 KB | 104 | 29 | 4.26% | 479 | clean |
| baseline repeat | 128 | 26 | 1.00% | 50 | clean |

Reading: the two baselines agree on the share of cycles over 50 us (0.99% and 1.00%) but differ 16-fold in the count over 80 us, so the max and the >= 80 us count are noise and the >= 50 us share is the usable metric.
GSO off makes the tail worse (4 to 8% over 50 us; the same segmentation work is done as many small packets on core 1), the 64 KB output limit changes nothing. Nothing came near the 44 to 47 us of layout A. iiod stayed alive and the stream stayed clean in every case.
A first run of this test was invalid and is not used: the soak's board-side monitor (`soak_mon.sh`) was still running `cyclictest` segments on core 1, so every case had a second `cyclictest` on the same core. Kill it after a soak.
Not tried (each needs more than a runtime setting): jumbo frames (host NIC and root on the host), a smaller iiod send size (iiod change), shorter irq-off sections in the slab allocator (kernel change).

### 16j. Shipped layout A on hardware: latency and stream check (image `known_good/sdimg-rt21-s23fix-iso`, 2026-10-29, hardware-measured)

Pluto+ SD boot with `isolcpus=1 irqaffinity=0`, iiod started by the fixed `S23udc` with no runtime pinning (all threads mask 1 = core 0, SCHED_OTHER), `cyclictest -t1 -p99 -i250 -a1 -h 400`, 10 MS/s over Ethernet with 32 blocks, 25 stream rounds per phase.
Load: the board's stock services; "waterfall load" = two `/waterfall` websockets and `/api` polling at 5 Hz from the host.

| Phase | `cyclictest` max / avg (us) | samples >= 50 us | stream |
|---|---|---|---|
| idle, 120 s (480000 samples) | 43 / 15 | 0 | not run |
| stream + waterfall load, 300 s (1.2M samples) | 48 / 15 | 0 | 25 of 25 rounds with lost blocks (16 to 58 per round, 1117 total), block gap median 34 to 45 ms (idle 26 ms) |
| stream + waterfall load + `stress-ng --cpu 1` on core 0 | 44 / 15 | 0 | 25 of 25 rounds with lost blocks (14 to 72 per round, 1294 total), gap median 31 to 56 ms |

iiod stayed alive in both stream phases. Reading: the isolated core meets 50 us with the shipped start script, matching the hand-pinned runs of 16b (44 to 47 us). The network stream, however, already loses blocks with only the waterfall websockets on core 0 (16c and the first version of 16g said "only when core 0 is loaded"; the waterfall load is enough).
So layout A suits on-board processing (the I/Q path in maia-hdl and local processing is not affected) or a dedicated RT mode with the web UI closed; for a clean Ethernet stream next to the web UI only layout B held (16d, 440-round soak), at 80 to 139 us. Not tested on this image: the original Pluto, a longer soak, the CPU-hog-free stream without the waterfall load (16b/16c ran it without websockets).

### 16k. How to switch the RT mode (layout A) on (2026-10-29, hardware-verified on the Pluto+ SD boot)

The default boot is unchanged (no `isolcpus`, iiod SCHED_RR 99 on core 1). To boot the isolated-core layout (A) add one line to `uEnv.txt` on the SD card (FAT partition):

```
rt_isolcpus=1
```

`sdboot_ram` (`board/tezuka/common/uboot-env.txt`) then adds `isolcpus=1 irqaffinity=0` to the kernel command line, and the fixed `S23udc` (16e) starts iiod plain on core 0. Remove the line to go back.
Check after boot: `cat /sys/devices/system/cpu/isolated` prints `1`, `taskset -p <iiod tid>` shows mask 1 and `chrt -p` SCHED_OTHER; without the line the file is empty and iiod runs SCHED_RR 99 with mask 2.
Do not use `fw_setenv` for this: on the Pluto+ it writes the QSPI environment. Only the SD RAM boot path has the switch (QSPI, USB and Kuiper boots are unchanged). Images used for the check: `known_good/sdimg-rt21-sw` (default) and `sdimg-rt21-sw-on` (same plus the line).
Layout A suits an RT task that needs under 50 us while the web UI and Ethernet streaming stay idle (16j); latency and stream were measured on the image with the identical kernel and `S23udc`, not repeated on these two images.

### 16l. Overnight soak of both modes (2026-10-29/30, hardware-measured, images `known_good/sdimg-rt21-sw` and `sdimg-rt21-sw-on`)

Setup: 10 MS/s stream over Ethernet with 32 blocks (5 s rounds), two web UI waterfall websockets plus API polling at 5 Hz, `cyclictest` in 600 s segments. The harness stops at the first problem (iiod gone, incomplete round, client ended) and leaves the board as is.

| Phase | Image | Duration | Rounds | Incomplete | Rounds with lost blocks |
|---|---|---|---|---|---|
| P1 default | `sdimg-rt21-sw` (no isolcpus, iiod SCHED_RR 99, mask 2) | 14457 s | 1338 | 0 | 0 |
| P2 `rt_isolcpus=1` | `sdimg-rt21-sw-on` (isolated=1, iiod SCHED_OTHER, mask 1) | stopped at 376 s | 16 | 0 | 16 (23 to 49 of 191 blocks per round) |

- P1: iiod stayed alive for the whole run (no repeat of the earlier deaths, 16f). `cyclictest -p98 -a0` max per 600 s segment: 343 to 691 us over 24 segments. The stream is clean, but core 0 carries all the housekeeping, so this mode gives no 50 us guarantee.
- P2: every round lost blocks with only the web UI load, the same result as layout A in 16c and 16j. No `cyclictest` segment completed, so no latency number for this phase. iiod was alive and the placement was as intended.
- Consequence: the opt-in switch (16k) is only for an RT task that runs while the web UI and Ethernet streaming are idle. The default stays the safe mode for streaming.
- After the soak the default image `sdimg-rt21-sw` was written back to the SD (checksums matched, board in default mode: no isolcpus, iiod SCHED_RR 99, mask 2) and a short stream check was run: 30 rounds of 5 s at 10 MS/s over Ethernet, 32 blocks, no web UI load: 30 complete, 0 with lost blocks.
- Not covered: deaths outside streaming, the shipped iiod cannot record an exit signal, the RX wedge (16f) did not occur. Logs: `hwtest/session-2026-10-25-rt/logs/overnight_2026-10-29/`.

### 16h. Next steps (replaces the RT items of section 15)
1. Decide the shipped layout (A or B). `S23udc` is fixed and verified (16e); the isolation is now an opt-in switch (`rt_isolcpus=1` in `uEnv.txt`, 16k).
2. The overnight soak of the default mode ran clean (16l); the wedge is a stale iiod client session (16f); find what hangs the session (iiod thread dump and a network capture at the stall) and whether the default mode can hit it.
3. Reduce the iiod transmit-path cost on core 1: runtime settings (GSO off, TCP output limit) did not help (16i); left are jumbo frames, a smaller iiod send size and kernel slab changes.
4. `nohz_full`/`rcu_nocbs` kernel rebuild only if layout A needs below 44 us; original Pluto RT image and USB gadget under RT are untested.
5. Linux 7.3: the rc7 bring-up and latency baseline are in section 17 (equal to 6.12 within noise). Before 7.3 is usable: port the ADI drivers, decide the QSPI handling for the 32 MiB flash, then re-pin to the final tag (the USB PHY device tree is verified, 17e).


## 17. Linux 7.3.0-rc7 on the Pluto+: bring-up and latency baseline (2026-10-30, hardware-measured unless marked as read from source)

### 17a. Setup and method
- Kernel: `v7.3-rc7` (tarball from git.kernel.org/torvalds/t, 270 MB), built outside the repo with the Buildroot `arm-linux-gcc` 15.1 of `output/plutoplus_rt`. Config: the resolved 6.12 RT `.config` plus `olddefconfig`; `PREEMPT_RT=y` (`ARCH_SUPPORTS_RT` is selected for ARM), `HZ=1000`, CMA 64 MB kept. The device tree is `zynq-plutoplus.dts` of this repo on top of the ADI `zynq.dtsi` and `zynq-7000.dtsi` (mainline has no `zynq.dtsi`). Image: `uImage` with `LOADADDR=0x8000`.
- Test images are the default image with the 7.3 `uImage` and `devicetree.dtb` swapped in (`known_good/sdimg-k73rc7-*`). The default image `sdimg-rt21-sw` was written back and verified (`/boot` checksums match, 6.12.114-rt21, no isolcpus). Nothing was pushed and no QSPI flash was written.
- No UART was available, so the boot log was read two ways: netconsole over Ethernet (`CONFIG_NETCONSOLE`, `log_buf_len=4M` so the early lines replay) and a small debug init script appended to the ramdisk as a second cpio archive. It copies `dmesg`, the process list and driver state to the FAT partition of the SD card. A control run on the 6.12 kernel proved the script and the appended archive work. Driver debug came from `*.dyndbg=+p` on the kernel command line and a few temporary prints in a scratch copy of `ci_hdrc` `core.c`, `spi-nor` `core.c` and `spi-zynq-qspi.c` (not kept).

### 17b. Config difference 6.12 to 7.3
133 differing symbols. The relevant ones are the out-of-tree drivers that 7.3 does not have: `AD9361`, `AD9361_EXT_BAND_CONTROL`, `CF_AXI_ADC`, `CF_AXI_DDS`, `ADI_IIO_FAKEDEV`, `COMMON_CLK_ADI`, `IIO_DMA_BUF_MMAP_LEGACY`, plus `XILINX_RESET_CODE`, `UIO_XILINX_APM` and `OF_CONFIGFS`. `MDIO_BUS`, `MDIO_DEVRES` and `USB_PHY` became hidden symbols that other drivers select. The USB gadget, ChipIdea, ULPI, Cadence GEM, Realtek PHY, MTD and SPI settings are identical, so no config setting explains the problems below. List: `hwtest/session-2026-10-25-rt/logs/k73_config_diff_6.12_vs_7.3.txt`.

### 17c. What works and what does not (7.3.0-rc7 boot on the Pluto+)

| Item | Finding | State |
|---|---|---|
| Kernel, SD card, userspace | Boots to `/init`, `mmcblk0p1` mounts, `iiod`, `dropbear`, `mosquitto` run | works |
| Ethernet | `macb` finds the Cadence GEM and the RTL8211E, link 1 Gbps full duplex. A transmit watchdog timeout (5 to 6 s) appeared once around the first link-up in 3 of the 4 fully captured boots and the queue recovered each time; the 6.12 board shows none | works, watchdog line unexplained |
| USB gadget | 7.3 ChipIdea does not read `usb-phy` or `xlnx,phy-reset-gpio`; it finds the PHY through `phys` (without it the probe ends silently with -ENXIO "no USB PHY"). Needs a `usb-nop-xceiv` node, `phys = <&usb_phy0>` on `&usb0` and `CONFIG_NOP_USB_XCEIV=y`. The reset must be active low: `reset-gpios = <&gpio0 46 1>`. With flag 0 the generic PHY driver leaves MIO46 low and the USB3320 stays in reset: the UDC binds, its state stays `powered`, `USBSTS` is 0, the ULPI viewport hangs and the host sees nothing | Live test: releasing the pin by hand and rebinding the UDC made `PlutoSDR`, the 30 MiB `TEZUKA` drive, RNDIS and ACM appear on the host. The corrected device tree (flag 1) enumerates the same devices at boot with no manual release (17e) |
| QSPI flash | The flash is 32 MiB. Mainline `spi-zynq-qspi` rejects 4-byte addresses, and the 7.3 `spi-nor` core needs them above 16 MiB, so no read mode is left: "can't select read settings supported by both the SPI controller and memory", probe -22, no `/dev/mtd*`. The 6.12 ADI/Xilinx `spi-nor` core has extra code for `xlnx,zynq-qspi-1.0` that keeps 3-byte addressing and switches banks with the extended address register (read from source). The 7.3 controller driver also writes the address bytes through `xqspi->txbuf` into the `op` structure (read from source) | not fixed |
| Network address | With no QSPI, `fw_printenv` fails, `ipaddr_eth` is empty and `S40network` configures `eth0` for DHCP, `usb0` stays 192.168.2.1. So 192.168.3.1 and 192.168.4.1 are missing. The test ramdisk sets 192.168.3.1 by hand (`S99dbgnet`) | consequence of the QSPI item |
| ADI drivers | No `ad9361`, `cf_axi_*`, so no `iio:device0` and no streaming. `watchdatveasy.sh` and `watchconsolefreq.sh` then spin in a tight `inotifywait` loop and use most of the CPU, so they were stopped for the baseline | to port |
| Mainline `axi-dmac` | The RX and TX DMA interrupts (`7c400000.dma`, `7c420000.dma`) register | not exercised |

Options for QSPI: (1) port the Xilinx bank-switching code of the 6.12 tree into the 7.3 `spi-nor` core and controller driver (verification needs flash writes, so only with a recovery path); (2) give the mainline driver 4-byte address support (the flash may then be left in a state that U-Boot or the BootROM does not expect after a reset); (3) skip QSPI and set the address by hand, as the test ramdisk does.

### 17d. Latency baseline on 7.3.0-rc7 against 6.12.114-rt21 (same board, same script)
`cyclictest -m -t1 -p98 -i250 -a1 -D 300 -q -h 5000`, 1.2 million samples per phase, no isolcpus. Phases: idle, `stress-ng --cpu 2`, and `stress-ng --cpu 4 --vm 2 --vm-bytes 96M --hdd 1 --hdd-bytes 32M`. A = 6.12 default image as shipped (`classifier`, `maia-httpd`, `api_controller.sh`, MQTT and the `watch*` scripts running). B = 6.12 with those services stopped, which is close to the service set of the 7.3 run. Times in us.

| Kernel | idle max | idle p99.9 | idle p99.99 | idle >50 | cpu2 max | heavy max | heavy p99.99 | heavy >100 |
|---|---|---|---|---|---|---|---|---|
| 6.12.114-rt21, A (shipped) | 86 | 61 | 67 | 20496 | 82 | 82 | 71 | 0 |
| 6.12.114-rt21, B (reduced) | 83 | 32 | 40 | 8 | 60 | 109 | 76 | 11 |
| 7.3.0-rc7 RT (reduced) | 62 | 35 | 47 | 50 | 65 | 117 | 99 | 90 |

- 7.3-rc7 and 6.12 are equal within the noise of single 5 minute runs; the maxima come from a handful of samples. Only the heavy phase is slightly worse on 7.3 (90 samples above 100 us against 11).
- The shipped services move the tail more than the kernel does: the idle p99 is 53 us as shipped and 24 us reduced; `classifier` alone uses about 20 % CPU.
- No `BUG`, `WARN`, hung task or RCU stall on either kernel. Neither kernel gets below 50 us worst case without isolating a core (16b); the `isolcpus` layout was not measured on 7.3.
- Not covered here: no streaming and no AD9361 on 7.3 at this point (see 17f for the stream test after the ADI port). Logs and scripts: `hwtest/session-2026-10-25-rt/logs/k73_baseline_2026-10-30/` and `k612_baseline_2026-10-30/` (each with a `SUMMARY.txt`), `scripts/ct_summarize.py`.

### 17e. Isolated core (`isolcpus=1 irqaffinity=0`) on 7.3.0-rc7 against 6.12.114-rt21 layout A (2026-10-30, hardware-measured)
Same board, same script and phases as 17d, `cyclictest` on the isolated core 1 (`-a1`), 5 minutes and 1.2 million samples per phase. 7.3 image: `known_good/sdimg-k73rc7-iso` (the default image with the 7.3 `uImage`, the device tree with the corrected USB PHY reset, and a ramdisk that sets `eth0` to 192.168.3.1 and stops the `watch*` loops). 6.12 image: `known_good/sdimg-rt21-sw-on`. The extra services (`classifier`, `maia-httpd`, `api_controller.sh` with MQTT, the `watch*` scripts) were stopped on 6.12 to match the 7.3 service set. Both: `isolated=[1]`, `iiod` SCHED_OTHER on core 0, stressors on core 0 only. Times in us.

| Phase | Kernel | min | avg | max | p99 | p99.9 | p99.99 | >50 | >100 |
|---|---|---|---|---|---|---|---|---|---|
| idle | 6.12 layout A | 9 | 11 | 37 | 17 | 27 | 30 | 0 | 0 |
| idle | 7.3-rc7 | 11 | 12 | 39 | 17 | 28 | 32 | 0 | 0 |
| cpu2 | 6.12 layout A | 9 | 11 | 39 | 18 | 27 | 31 | 0 | 0 |
| cpu2 | 7.3-rc7 | 11 | 12 | 44 | 19 | 28 | 32 | 0 | 0 |
| heavy | 6.12 layout A | 10 | 13 | 49 | 24 | 29 | 35 | 0 | 0 |
| heavy | 7.3-rc7 | 11 | 14 | 61 | 26 | 32 | 39 | 11 | 0 |

- Isolating core 1 cuts the 7.3 tail from 62, 65 and 117 us (17d, no isolation) to 39, 44 and 61 us. The 50 us goal is met on 7.3 at idle and under `--cpu 2`; in the heavy phase 11 of 1.2 million samples exceed it (maximum 61 us). On 6.12 layout A the goal is met in all three phases (heavy maximum 49 us).
- 7.3 runs 2 to 5 us above 6.12 at every percentile and phase. That is small, comes from single 5 minute runs and rare samples, and the 7.3 build carries extra options (`DYNAMIC_DEBUG`, `NETCONSOLE`, debug prints). Repeat the 7.3 heavy phase before reading anything into the 12 us gap.
- Not covered: no streaming and no AD9361 on 7.3, so the layout A problem (lost blocks with network load on core 0, 16c and 16j) cannot be compared. The conclusion of 16g stands.
- The corrected USB PHY device tree (`reset-gpios = <&gpio0 46 1>`) was booted without any manual pin release in this run: the `PlutoSDR` and the 30 MiB `TEZUKA` drive enumerate on the host from boot. This closes the open point in 17c.
- Logs: `hwtest/session-2026-10-25-rt/logs/k73_isolcpus_2026-10-30/` and `k612_isolcpus_2026-10-30/` (each with a `SUMMARY.txt`).

### 17f. ADI driver port to 7.3.0-rc7 and the I/Q stream (2026-10-30/31, hardware-measured on the Pluto+)

**Port.** `ad9361`, `cf_axi_adc_core`, `cf_axi_dds` (with `buffer_stream`) and `clk-adjustable-rate` were taken from the ADI 6.12 tree and built into the scratch 7.3 tree. The build has 0 errors and 0 warnings. 7.x API changes that had to be handled: `of_gpio.h` is gone, clock `round_rate` became `determine_rate` (wrappers), `bin_attribute` callbacks take const, `write_event_config` takes a bool, `MODULE_IMPORT_NS` takes a string, `IIO_CHAN_INFO_CALIBPHASE` had to be added to the IIO core (with the name `calibphase`), `ADI_AXI_REG_ID` and related defines were added to `adi-axi-common.h`, and the `jesd204`, `clkscale` and dt-bindings headers were copied. The DDS buffer uses `devm_iio_dmaengine_buffer_setup_ext` without the ADI submit and abort hooks. Patch: `hwtest/session-2026-10-25-rt/k73_port/0001-adi-ad9361-axi-drivers-for-7.3-rc7.patch` (31 files, applies to a pristine rc7 in a dry run), with `README.txt`, the config and the device tree.

**First boot on the Pluto+.** AD936x initialises, DDS and ADC probe as AD9364, `iiod` serves the libiio 1.0 client, RX at 10 MS/s works and TX with cyclic DMA works. The device order differs from 6.12: `iio:device0` is `xadc`, `device1` `ad9361-phy`, `device2` `cf-ad9361-dds-core-lpc`, `device3` `cf-ad9361-lpc` (on 6.12 `ad9361-phy` is `device0`). The DDS tone registers (0x400 to 0x44c) ignore writes in this FPGA design, so test tones must come through DMA.

**Stream test.** AD9361 digital loopback plus a cyclic TX tone (1.25 MHz, DMA), RX at 10 MS/s over Ethernet with the libiio 1.0 host `iio_rwdev -b 262144`, a phase jump detector (512 sample blocks, jump above 0.4 rad), shuffled rounds of 5 s with a 3 s gap. Slips are counted, not whole lost blocks.

| Case | Rounds | Rounds with slips | Slips |
|---|---|---|---|
| 6.12 default, 32 blocks | 20 | 0 | 0 |
| 6.12 default, 4 blocks | 20 | 3 | 5 |
| 7.3, no DMA heap, 32 blocks | 20 | 20 | 342 |
| 7.3, no DMA heap, 4 blocks | 20 | 20 | 353 |
| 7.3, `reserved` heap, 32 blocks | 30 | 2 | 5 (max 4 per round) |
| 7.3, `reserved` heap, 4 blocks | 30 | 29 | 194 |

- Without a DMA heap every round was bad. The slips sit exactly on 262144-sample block boundaries and the jumps are multiples of 90 degrees (2, 4 or 6 sample slips), so samples are lost at the hand-over between blocks, not whole blocks. The number of blocks made no difference.
- A local capture on the board (no network) had 0 slips in about 1000 blocks, against 131 slips in 12 network captures in the same session. The RX DMA and kernel buffer are therefore fine and the loss is in the `iiod` and libiio read path.
- Cause: `CONFIG_DMABUF_HEAPS` was off, so there was no `/dev/dma_heap` and libiio 1.0 fell back to `read()` with about 2 blocks. Fix: `DMABUF_HEAPS=y`, `DMABUF_HEAPS_SYSTEM=y`, `DMABUF_HEAPS_CMA=y` (heaps `system`, `reserved`, `default_cma_region`) and `LIBIIO_DMA_HEAP_PATH=reserved` for `iiod`. A second `iiod` (SCHED_RR 99 on core 1) with 32 blocks, 10 rounds: `reserved` 0 slips, `default_cma_region` 0, `system` 1 slip.
- Result: 7.3 with the heap is close to 6.12 but not equal. At 32 blocks 28 of 30 rounds are clean (6.12: 20 of 20). At 4 blocks 7.3 is much worse (194 slips against 5), so the block count matters more on the new path. The residual 5 slips at 32 blocks need a longer run before they can be called real.
- Not yet in the shipped path: the boot `iiod` still uses the default `system` heap, because `S23udc` was not changed. The firmware needs `LIBIIO_DMA_HEAP_PATH=reserved` there, or a different libiio default.
- Setup difference: 7.3 ran with few services (no `classifier`, `maia-httpd`), 6.12 with the shipped set, which makes the 6.12 control the harder case. TX was tested only with the cyclic tone. `maia-kmod` and `maia-httpd` were not tried on 7.3, and QSPI is still open (17c).
- Logs and tools: `hwtest/session-2026-10-25-rt/logs/k73_adi_stream_2026-10-30/` (`SUMMARY.txt`, `drop73_run1.log`, `drop612_run1.log`, `drop73_reserved.log`, `drop73.py`, `slip.py`, `tone.bin`). The saved port config predates the `DMABUF_HEAPS` options, which must be added.

### 17g. Why 7.3 lost samples at 4 blocks, and the fix (2026-10-31, hardware-measured on the Pluto+)

**Where the loss is.** `ftrace` (function tracer, built into the 6.12 and 7.3 test kernels only; the shipped kernels have no tracing) on the RX path during a 10 MS/s network stream. The DMA and its interrupt are fine on both kernels. The DMA queue runs empty when a finished block is handed back late, and the hand-back is slower on 7.3.

| 4 blocks, about 9 s | 6.12.114-rt21 | 7.3.0-rc7 (`reserved` heap) |
|---|---|---|
| Times the DMA queue ran empty | 0 | 26 (gaps up to 114 ms) |
| Block done to block re-enqueued: median / p99 / max | 24 / 51 / 53 ms | 28 / 169 / 213 ms |

At 10 MS/s a block lasts 26.2 ms, so 4 blocks give about 105 ms of slack. At 32 blocks the queue did not empty on either kernel. On 7.3 the path is: interrupt thread marks the block done, `writer-task` sends it (`tcp_sendmsg`, about 4 ms), `net_client_thd` gets the client reply, `buffer-enqueue` re-queues the block.

**Cause found.** In the slow windows CPU 0 was about 93 % busy with `irq/31-eth` and `ktimers/0`. `ktimers/0` runs at SCHED_FIFO 1. On 7.3 it was switched in 34628 times against 2055 on 6.12 for about 1200 wakeups, each time boosted to priority 49 by priority inheritance while the Ethernet interrupt thread was blocked on the softirq lock: the two threads contend on CPU 0 and the network transmit stalls. (Trace overhead loads both CPUs to about 90 % on both kernels, so these figures compare the kernels only relatively.) The shipped shell services (`api_controller`, MQTT, `watch*`) were also seen running in the slow windows but are not the cause.

**Experiments** (runtime changes on the 7.3 test image, main `iiod` with the `reserved` heap, loopback tone, 15 rounds of 5 s per setting, slips counted by the phase jump detector):

| Variant | 4 blocks: slips (rounds with slips) | 32 blocks: slips |
|---|---|---|
| A: shipped services running | 133 (15) | 2 |
| B: services stopped | 164 (13) | 0 |
| C, C2: B and `irq/31-eth` at FIFO 99 (was 50) | 50 (8) and 71 (10) | 0 and 1 |
| D, D2: B and `irq/31-eth` and `ktimers/0` at FIFO 99 | 1 (1) and 3 (3) | 0 |
| E: services stopped, `ktimers/0` at FIFO 99 only | 3 (2) | 0 |
| F: after a reboot, services running, `ktimers/0` at FIFO 99 only | 5 (5) | 0 |

- `ktimers/0` at FIFO 99 is the lever. With it, 7.3 at 4 blocks has 5 slips in 5 of 15 rounds with the shipped services running (6.12 default: 5 slips in 3 of 20 rounds). Raising only the Ethernet thread helps by a third to a half.
- Run `chrt -f -p 99` on the `ktimers/0` thread; it is lost at reboot. It is not in the firmware yet. A boot script would need to find the kernel thread by name and set the priority; whether `ktimers/1` needs it too was not tested.
- Logs: `hwtest/session-2026-10-25-rt/logs/k73_axi_dmac_trace_2026-10-31/` (`SUMMARY.txt`, the traces, `exp_*.log` and the analysis scripts).

**What goes into the firmware for 7.3.** `S23udc` exports `LIBIIO_DMA_HEAP_PATH=reserved` when `/dev/dma_heap/reserved` exists (6.12 images have no heap and are unaffected). Together with the 32-block default of `zynqrx` this gave, over 30 rounds at 32 blocks, 16 slips in 4 rounds and 26 clean rounds (6.12: no slips in 20 rounds). `etc/init.d/S24rtprio` sets every `ktimers/N` thread to SCHED_FIFO 99 at boot on kernel 7 and newer (6.x is left alone). Test of the image with the script, started from a reboot with nothing changed by hand, shipped services running, main `iiod` with the `reserved` heap, 30 rounds of 5 s per setting: 4 blocks 10 slips in 7 rounds (23 rounds clean, at most 2 per round), 32 blocks 0 slips (30 clean rounds). 6.12 default for comparison: 4 blocks 5 slips in 3 of 20 rounds, 32 blocks 0. Whether `ktimers/1` needs the change was not tested separately (the script sets both). Log: `exp_G_boot_script.log`.

### 17h. maia-kmod and maia-httpd on 7.3.0-rc7 (2026-10-31, hardware-measured on the Pluto+)

- **Kernel patch needed.** `maia-sdr.ko` calls `v7_dma_inv_range` and `arm_cache_outer_inv_range` directly. Mainline does not export them; the 6.12 tree does through `board/tezuka/common/patches/linux/adi-6.12.y/005-maiasdr.patch`. Without it `modpost` stops with undefined symbols. The patch applies to rc7 with line offsets only (checked with the build, no other change). A 7.3 kernel therefore carries that patch.
- **Module.** `maia-kmod` 0.12.0 with the five patches of `package/maia-kmod`, built out of tree against the 7.3 tree (vermagic `7.3.0-rc7 SMP preempt_rt mod_unload modversions ARMv7`). The ramdisk of the test image carries it under `/lib/modules/7.3.0-rc7/updates` with `depmod` files; `S50maia-kmod` loads it at boot, the devices `maia-sdr-spectrometer`, `-recording`, `-raw-capture` and `-iq-waterfall` appear and `maia-httpd` (`S60`) starts. No BUG, WARN, Oops or RCU message in `dmesg`.
- **Tests** (BIST tone as the source; the test scripts use `iio:device0` for the AD9361, which is `iio:device1` on 7.3, so copies with the index changed were run):

| Test | Result |
|---|---|
| `wftone.py`: waterfall follows the stepped tone | Peak bins 2175, 2559, 2303, 2431 as on 6.12; settled within 2 frames; distinct settled spectra per tone 11, 13, 10, 11 (6.12 runs: 8 to 16) |
| `kmodrace`, 20 s: mmap/munmap against `IOCTL_CACHEINV` | 239955 maps, 170195 successful invalidations, no oops or hang |
| `tonetest.py`, 20 s: BIST 960 kHz, DDC, CS16 capture | 30.72 M samples, 0 I/Q misalignment per million, 0 dropouts |
| Recorder via REST, 4 s, BIST 960 kHz | 33554432 `ci16` samples (the 128 MiB region, full), tone at 960.5 kHz, 0 phase jumps above 0.5 rad, 0 zero samples |

- **Not tested.** Raw capture and the I/Q waterfall: the shipped `maia-httpd` has no API for them (the kernel devices exist and load). No multi-hour run of `maia-httpd` under load.
- **Files.** Logs and scripts: `hwtest/session-2026-10-25-rt/logs/k73_maia_2026-10-31/`; module: `hwtest/session-2026-10-25-rt/k73_port/maia-sdr-7.3.0-rc7.ko`. Test image: `known_good/sdimg-k73rc7-maia` (kernel with tracing and the `005` patch).

### 17i. Settings storage without QSPI, USB address and dashboard on 7.3.0-rc7 (2026-10-31, hardware-measured on the Pluto+)

- **Problem.** The operator name, callsign, locator, reference clock, `xo_correction`, `classifier_enabled`, the network addresses and other settings live in the U-Boot environment, which `fw_printenv`/`fw_setenv` read through `/etc/fw_env.config` from `/dev/mtd1` (QSPI). 7.3 cannot read the flash (17c), so `fw_printenv` fails with `Cannot open /dev/mtd1`. The dashboard Operator page then lost what was typed: `api_controller.sh` republishes the empty stored value over MQTT a few seconds after the save.
- **Stand-in.** `board/tezuka/common/overlay_base/etc/init.d/S20fwenv` runs after `S20fat-mount`. If `/dev/mtd1` does not exist it creates `/boot/uboot.env` (128 KiB, on the FAT partition), writes `/etc/fw_env.config` to point at it and writes one variable so the file holds a valid CRC. With `/dev/mtd1` present it does nothing, so images that can read the QSPI flash are unchanged, and it hands back to the real environment once QSPI works. U-Boot does not read this file, so the boot is unchanged; only scripts that call `fw_printenv`/`fw_setenv` see it. Writing a test image with `sd_write.sh` (`rsync --delete`) deletes the file and `/boot/jffs2`; a reboot over ssh keeps them.
- **Test.** Over MQTT (`cmd/operator/callsign`, `cmd/operator/name`, `cmd/operator/locator`, the topics the dashboard publishes to) three values were stored and read back with `fw_printenv`; they were still there after a reboot, and the dashboard showed them. Operator values saved from the browser form were not clicked through.
- **`/mnt/jffs2` and the serial number.** `/dev/mtd2` is missing too, so `S22serial` generated a new random serial at every boot, and the USB gadget MACs (a SHA-1 of the serial) and the HTTPS certificates changed with it (host interface `enx00e0222d75e2`, then `enx00e022295471`, then others). `S20fwenv` now also bind-mounts `/boot/jffs2` on `/mnt/jffs2` when `/dev/mtd2` is missing, and `S20jffs2` returns early without `/dev/mtd2`. The serial, the certificates and `bandplan.json` then persist; the private key of the HTTPS certificate is on the FAT partition. Checked on the Pluto+: the serial and MAC are identical across a reboot, `maia-httpd` serves HTTPS, and `/mnt/jffs2` is the SD folder.
- **This board's settings.** After a `sd_write.sh` write the board's own data had to be seeded again over ssh: `/boot/jffs2/serial.txt` holds the serial `WZ5Z6HQZ6IXHI5QI` from the 14 Oct flash backup (`mtd2`), so the MAC and identity match the 6.12 images, and `fw_setenv` was run with the values of the backup's U-Boot environment (`ipaddr` 192.168.4.1, `ipaddr_host` 192.168.4.10, `ipaddr_eth` 192.168.3.1, operator `MABE`, `hostname` `plutoplus`, `refclk_source` `internal`, `classifier_enabled` 1 and the rest). With these the board comes up on 192.168.4.1 (USB) and 192.168.3.1 (Ethernet), apart from the original Pluto's 192.168.2.1. The MAC is stable (`00:e0:22:0a:e2:77`), `tezuka-usb` on the PC (192.168.4.10) follows it.
- **USB network and dashboard.** The USB gadget MAC changes at every boot on 7.3 (host interface `enx00e0222d75e2` became `enx00e022295471`; cause not examined, perhaps the missing serial). A host profile that matches the interface name loses the address at the next reboot (fixed by the stable serial above). On the PC a NetworkManager profile `tezuka-usb` (192.168.2.10/24, manual, no gateway, matching `enx00e022*`) keeps the link up. Without a host address on the USB network `info.html` (links to 192.168.2.1) fails, and so does the dashboard: it opens its MQTT WebSocket on port 9001 of the same address, and with MQTT offline it shows the built-in demo values from `index.html` (Linux 5.15.0, Tezuka v2.4.1, libiio 0.25, Zynq-7020 / AD9363), not the board's. With MQTT connected the Versions page shows Pluto+ (Z7010-AD9361), `tezuka-v0.3.24-83-gcad7`, Linux 7.3.0-rc7, Buildroot 2026.08.1, libiio 1.0.0.
- **Kernel.** `iptables` cannot load (no netfilter module in the 7.3 config); there is no `/etc/iptables.conf`, so nothing depends on it today.

### 17j. Kernel branch for 7.3: `tezuka/7.3-rc7` in `mbehn1976/linux` (2026-10-31)

The ADI drivers and the cache export patch were moved from the scratch tree into a git branch on top of `v7.3-rc7` (`24a19b95`). Local clone: `~/code/linux-k2`; branch `tezuka/7.3-rc7`, three commits:

| Commit | Content |
|---|---|
| `556e945` | `arch: arm: export Zynq cache invalidation functions` (`005-maiasdr.patch` of the 6.12 tree; author Daniel Estévez, Mario Behn added as sign-off) |
| `106ee90` | `iio: add the ADI AD9361, AXI ADC and AXI DDS drivers, ported to 7.3` (31 files: `ad9361`, `cf_axi_adc_core`, `cf_axi_dds` with the buffer stream, `clk-adjustable-rate`, the `jesd204`, `clkscale` and binding headers, `Kconfig.adi` files, the IIO `calibphase` attribute, `adi-axi-common.h`) |
| `3b961a9` | `ARM: dts: zynq: take the ADI zynq.dtsi and zynq-7000.dtsi` |

- **Base is exact.** All 96080 files of the 7.3-rc7 tarball used until now are byte-identical to the git tag (checked blob by blob), so the booted scratch tree was rc7 plus these 37 files plus temporary debug prints.
- **Build and boot from the branch.** A fresh tree made of the tarball and only the branch's files, with the same kernel config, builds with exit 0 (`7.3.0-rc7 #1 SMP PREEMPT_RT`). The only new warning is `no previous prototype for arm_cache_outer_inv_range` in `outercache.c`, carried over from the 6.12 patch. The image (`known_good/sdimg-k73rc7-branch`) boots on the Pluto+: AD9361 initialises, the four IIO devices (`xadc`, `ad9361-phy`, `cf-ad9361-dds-core-lpc`, `cf-ad9361-lpc`) appear, `maia-sdr.ko` rebuilt against that tree loads, `iio_readdev` on the board delivers 2621440 samples, the DMA heaps exist, no BUG, WARN or Oops. The stream drop test was not repeated for this build (the 37 files are the ones measured in 17f and 17g); the Pluto+ Ethernet port could not be reached from the PC during this boot test.
- **The Tezuka patches of `adi-6.12.y`.** The source tree the drivers were copied from (`mbehn1976/linux` `678c4de70fdf`) already carries `0002-extend_freq` (AD9363 LO range 46.875 MHz to 6 GHz, in `ad9361_regs.h`) and `0008` (chip tables of other AXI DDS cores only with `CONFIG_CF_AXI_DDS_MULTICHIP`, which is left undefined), so both are part of the ported files; on the Pluto+ with the branch kernel the RX and TX LO were set from 60 MHz to 6 GHz. `0004-ad5660` adds the Microphase drivers `ad5660_mp` and `mpiio_io` (only the `e200`, `e310` and `libre` device trees have nodes for them, not `plutoplus.dts`) and Winbond handling in the SPI-NOR extended address register code, which 7.3 does not have (QSPI, 17c); the drivers were not ported. `0006` (`USB_ULPI` selects `USB_PHY`) was not needed for the 7.3 build and `0007` (ssd130x display) is not enabled in the Pluto+ config.
- **Not in the branch.** The Pluto+ device tree files (`plutoplus.dts`, `maiasdr.dtsi`, `zynq-plutoplus.dtsi`, which stay in this repository), the QSPI work (17c) and the kernel config. `plutoplus_rt_defconfig` still pins the 6.12 kernel; nothing in this repository selects the branch yet.
- **Not pushed; patches instead.** Pushing the branch to `mbehn1976/linux` (a fork of `analogdevicesinc/linux`, which does not have the 7.3 history) would send 173878 commits and about 1.09 million objects, 294684 of them file contents missing from the partial clone, so several GB each way. The three commits are exported as `board/tezuka/common/patches/linux/7.3-rc7/0001-*.patch` to `0003-*.patch` (each applies with `patch -p1` to a pristine `v7.3-rc7`, dry run) and the branch stays local in `~/code/linux-k2`.
- **History.** `v7.3-rc7` was fetched into the clone from `github.com/torvalds/linux` without file contents (+0.3 GB); `git.kernel.org` ignores the partial-clone filter.
- **Reminder for image writes.** `sd_write.sh` deletes `/boot/uboot.env` and `/boot/jffs2` (17i); after each write the serial and the environment of the board have to be seeded again, otherwise the USB MAC and the addresses change (seen again in this test).

### 17k. QSPI on 7.3.0-rc7 (read only) and the Buildroot build of the 7.3 image (2026-10-31, hardware-measured on the Pluto+)

**Flash.** W25Q256 (JEDEC `ef4019`, 32 MiB, extended address commands `C5`/`C8`). Cause of 17c: the Zynq QSPI controller sends at most 3 address bytes, `spi-nor` 7.3 needs 4 for a flash above 16 MiB. Patch `0004-spi-zynq-qspi-reach-a-flash-above-16-MiB-through-the.patch` (controller driver only, `spi-nor` core untouched): a 4-byte-address operation becomes write enable, `WREAR` with `addr >> 24`, the operation with the 3-byte opcode and the low 24 address bits, then `WREAR` 0 again, so that U-Boot and the BootROM find bank 0 after a reset. `adjust_op_size` keeps a read inside a 16 MiB bank, `EN4B`/`EX4B` are swallowed so the flash stays in 3-byte mode, and the address bytes no longer go through `xqspi->txbuf` into the `spi_mem_op`. **This stage is read only:** every operation that does not read data is refused with `-EROFS`. Writes are not implemented or tested.

**Result.** `/dev/mtd0` to `mtd3` appear. The md5 of all four partitions on 7.3 equals the read taken on 6.12 the same day (`known_good/flash-ref-plutoplus-2026-10-31`, identical to the backup of 2026-10-14), including `mtd3`, which crosses the 16 MiB boundary. A 4 KiB read across flash offset `0x1000000` matches, `mtd0` still reads correctly after an upper-bank read (extended address reset), 30 MiB read in 2.3 s. The guard refused no operation. `fw_printenv` shows the real environment and `mtd2` mounts as jffs2, so `S20fwenv` does nothing on this image.

**Buildroot build.** `configs/plutoplus_rt73_defconfig` builds the 7.3 image like the 6.12 ones: mainline tarball `file:///home/mb/code/linux-7.3-rc7.tar.gz` (v7.3-rc7, local copy), patches `board/tezuka/common/patches/linux/7.3-rc7/` (0001 cache export, 0002 ADI drivers, 0003 zynq.dtsi, 0004 QSPI; kernel branch `tezuka/7.3-rc7` commit 080e637, local only), complete kernel config `board/tezuka/plutoplus/kernel/zynq_pluto_linux_73_defconfig` (the tested 7.3 config without tracing; `PREEMPT_RT`, DMA heaps), device tree directory `kernel-dts-7.3` (USB PHY through `usb-nop-xceiv`). Command: `make -C buildroot O=output/plutoplus_rt73 plutoplus_rt73_defconfig` then `make -C buildroot O=output/plutoplus_rt73 -j16` (about 40 minutes from scratch). Output: `images/sdimg` (kept as `known_good/sdimg-rt73-br`) and `pluto.frm` (not flashed, not tested; it would write the QSPI). `maia-kmod` is built by Buildroot with its five patches.

**Test of `sdimg-rt73-br` on the Pluto+.** Boots 7.3.0-rc7 `PREEMPT_RT`, AD9361 initialises, three DMA heaps, `iiod`, `mosquitto`, `maia-httpd` and `maia_sdr` run, no `BUG`/`WARNING`/Oops. Local capture 3 x 2621440 samples. RX LO set to 60 MHz and 6 GHz. `maia` spectrum with four tones: peak bins 2175/2303/2431/2559 as on the earlier 7.3 image, settled within 3 frames. Not run on this image: the Ethernet stream drop test (the PC has no 192.168.3.x address), the multi-hour soak, any flash write. Logs: `hwtest/session-2026-10-25-rt/logs/k73_qspi_ro_2026-10-31/` and `k73_qspi_br_2026-10-31/`.

### 17l. Stream test and soak on the Buildroot 7.3 image against a 6.12 control (2026-10-31, hardware-measured on the Pluto+, USB link only)

Setup: `sdimg-rt73-br` (17k) and `sdimg-rt21-sw`, AD9361 loopback, cyclic TX tone, RX 5 MS/s over the USB link (192.168.4.1; the Ethernet path was not available because the PC has no 192.168.3.x address), libiio 1.0 `iio_rwdev -b 262144`, 32 blocks, 5 s rounds, phase-jump detector as in 17f, board monitor once a minute (memory, `iiod` size, die temperature, TX writer, kernel log, `maia` API). Short tests before the soak: 2.5 MS/s 0 slips; 5 MS/s with 4 blocks slips (44 in 3 rounds), with 32 blocks 0 in 3 rounds.

| Run | Rounds | Incomplete | Rounds with slips | Slips (max/round) | AD9361 SPI timeouts |
|---|---|---|---|---|---|
| 7.3, run 1 (about 55 min) | 191 | 18 (from round 174 on) | 113 | 216 (6) | 19 at the end |
| 7.3, run 2 (after reboot, 21 min) | 85 | 0 | 45 | 60 (4) | 5 |
| 6.12 control (18 min) | 90 | 0 | 19 | 19 (1) | 0 |

- **SPI timeouts on 7.3.** `ad9361 spi0.0: SPI transfer timed out`, `spi_master spi0: failed to transfer one message from queue`, `Read Error -110` / `Write Error -110` (also from `iio_debugfs_write_reg`). The SPI core waits 200 ms plus twice the transfer time for the completion interrupt of `spi0` (Cadence SPI). The first timeout came about one minute after the stream started in both runs. The chip still answered afterwards (register 0x37 = 0x0A). In run 1 the errors piled up until libiio could no longer read the attributes when `iio_rwdev` opened the device, so rounds from 174 on failed; the stream itself does not use SPI. My first monitor missed the SPI messages (its pattern had no SPI strings), so run 1 was only noticed at that point.
- **Not the cause of the difference:** memory (flat), temperature (65 to 68 C on both), the QSPI interrupt rate (about 1400 per second on both kernels, so the shipped scripts poll the flash).
- **Conclusion.** On this USB path 7.3 is worse than 6.12: about three times the slips and an AD9361 SPI problem that 6.12 does not show. This corrects the impression of 17f to 17k that 7.3 is on par; the Ethernet 10 MS/s results there stand but were short and ran without the full service set. The Ethernet 10 MS/s soak was not run. Cause not found. Next steps to isolate: stop `watch*`/`api_controller`/`maia-httpd` on 7.3, boot an image without the QSPI patch, boot without `S24rtprio`, check priority and affinity of the `spi0` interrupt thread.
- Logs: `hwtest/session-2026-10-25-rt/logs/k73_soak_2026-10-31/` (`SUMMARY.txt`, `fail/`, `control_612/`).

