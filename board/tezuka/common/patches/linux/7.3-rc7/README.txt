Kernel patches for Linux 7.3 (PREEMPT_RT), applied on top of the mainline tag v7.3-rc7 (git: torvalds/linux 24a19b95).
They are the three commits of the local branch tezuka/7.3-rc7 (clone ~/code/linux-k2), made with git format-patch:
  0001 export the Zynq cache invalidation functions (needed by the maia-sdr kernel module; 005-maiasdr.patch of adi-6.12.y)
  0002 the ADI AD9361, AXI ADC and AXI DDS drivers ported to 7.3 (from the ADI 6.12 tree)
  0003 the ADI zynq.dtsi and zynq-7000.dtsi
Each applies with patch -p1 to a pristine v7.3-rc7 tree. No defconfig selects this directory yet (plutoplus_rt_defconfig still pins 6.12).
Not included: the QSPI work and the kernel config. Of the adi-6.12.y patches, extend_freq (0002) and the cf_axi_dds MULTICHIP gating (0008) are already part of 0002 here; ad5660 (0004, drivers for the e200/e310/libre boards and Winbond EAR handling in spi-nor), usb-ulpi-select-usb-phy (0006) and ssd130x (0007) are not ported. See doc/UPGRADE_REALTIME_7.3.md 17c and 17j.
