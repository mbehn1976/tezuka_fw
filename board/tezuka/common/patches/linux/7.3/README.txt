Kernel patches for Linux 7.3 (PREEMPT_RT), applied on top of the mainline tag v7.3 (git: torvalds/linux c03c1a14, released 2026-10-18).
They are the five commits of the local branch tezuka/7.3 (clone ~/code/linux-k2, worktree ~/code/linux-73), made with git format-patch:
  0001 export the Zynq cache invalidation functions (needed by the maia-sdr kernel module; 005-maiasdr.patch of adi-6.12.y)
  0002 the ADI AD9361, AXI ADC and AXI DDS drivers ported to 7.3 (from the ADI 6.12 tree)
  0003 the ADI zynq.dtsi and zynq-7000.dtsi
  0004 spi-zynq-qspi: reach the 32 MiB W25Q256 through the Extended Address Register; READ ONLY (writes are refused with -EROFS), hardware-verified by md5 of mtd0-3 against 6.12 (on 7.3-rc7)
  0005 spi-cadence: recover the controller after a failed transfer (handle_err: mask, drain the RX FIFO, re-init). Without it one SPI timeout leaves the AD9361 unreadable until reboot (doc 17l, 17m). Candidate for mainline.
0001 to 0004 are the 7.3-rc7 patches rebased unchanged (no file they touch changed between v7.3-rc7 and v7.3).
Each applies with patch -p1 to a pristine v7.3 tree. configs/plutoplus_rt73_defconfig selects this directory (plutoplus_rt_defconfig still pins 6.12).
Not included: QSPI write support (0004 is read only) and the kernel config (board/tezuka/plutoplus/kernel/zynq_pluto_linux_73_defconfig). Of the adi-6.12.y patches, extend_freq (0002) and the cf_axi_dds MULTICHIP gating (0008) are already part of 0002 here; ad5660 (adi-6.12.y 0004, drivers for the e200/e310/libre boards and Winbond EAR handling in spi-nor), usb-ulpi-select-usb-phy (0006) and ssd130x (0007) are not ported. See doc/UPGRADE_REALTIME_7.3.md 17c, 17j and 17m.
