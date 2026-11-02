Kernel patches for the 6.12.114-rt21 kernel of configs/plutoplus_rt_defconfig. That kernel comes as the tarball linux-rt-fcde289.tar.gz
(ADI 6.12 at 678c4de70fdf plus patch-6.12.111-rt21, with the adi-6.12.y patches already applied in the tree; doc/UPGRADE_REALTIME_7.3.md
sections 9 and 17j). Until 2026-11-02 the defconfig applied no patches on top of it.
  0001 usb chipidea udc: bound the endpoint halt loop. The same file as 7.3/0006; the bug is in both kernels (the loop is unchanged
       upstream since 2011). Hardware-verified 2026-11-02: 1 of 120 boots of a 6.12 debug image hit the refused ep0 stall and came up
       with a working USB link; without the patch that boot wedges the gadget (doc 17p).
  0002 spi-cadence: recover the controller after a failed transfer. The same file as 7.3/0005 (applies with an offset of 6 lines in the
       probe hunk). Without it one SPI timeout leaves the AD9361 unreadable until reboot; 6.12 as shipped wedges under a USB throughput
       test with the SPI thread at FIFO 50 (doc 17n). Applies and builds (sdimg-rt21-v2, 2026-11-02); the 17n provocation gave no timeout
       over NCM, so the recovery path is hardware-verified on 7.3 only (doc 17m, 17q, 17r).
Each applies with patch -p1 to the tarball's tree.
