Kernel patches for the 6.12.114-rt21 kernel of configs/plutoplus_rt_defconfig. That kernel comes as the tarball linux-rt-fcde289.tar.gz
(ADI 6.12 at 678c4de70fdf plus patch-6.12.111-rt21, with the adi-6.12.y patches already applied in the tree; doc/UPGRADE_REALTIME_7.3.md
sections 9 and 17j). Until 2026-11-02 the defconfig applied no patches on top of it.
  0001 usb chipidea udc: bound the endpoint halt loop. The same file as 7.3/0006; the bug is in both kernels (the loop is unchanged
       upstream since 2011). Hardware-verified 2026-11-02: 1 of 120 boots of a 6.12 debug image hit the refused ep0 stall and came up
       with a working USB link; without the patch that boot wedges the gadget (doc 17p).
Each applies with patch -p1 to the tarball's tree.
