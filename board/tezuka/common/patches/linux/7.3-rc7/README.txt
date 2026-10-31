Kernel patches for Linux 7.3 (PREEMPT_RT), applied on top of the mainline tag v7.3-rc7 (git: torvalds/linux 24a19b95).
They are the three commits of the local branch tezuka/7.3-rc7 (clone ~/code/linux-k2), made with git format-patch:
  0001 export the Zynq cache invalidation functions (needed by the maia-sdr kernel module; 005-maiasdr.patch of adi-6.12.y)
  0002 the ADI AD9361, AXI ADC and AXI DDS drivers ported to 7.3 (from the ADI 6.12 tree)
  0003 the ADI zynq.dtsi and zynq-7000.dtsi
Each applies with patch -p1 to a pristine v7.3-rc7 tree. No defconfig selects this directory yet (plutoplus_rt_defconfig still pins 6.12).
Not included: the other adi-6.12.y patches, the QSPI work and the kernel config. See doc/UPGRADE_REALTIME_7.3.md 17c and 17j.
