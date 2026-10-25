# DRAFT, not posted. Target: analogdevicesinc/linux (PR against xlnx/release/v6.12.y-2026r1, or an issue first)
# Patch file: 0001-iio-cf_axi_dds-attach-the-buffer-setup-ops-again.patch (678c4de70fdf)
# Checked only on xlnx/release/v6.12.y-2026r1; I have not looked at ADI main or other release branches.

Title: iio: cf_axi_dds: DAC keeps replaying the last DMA data after the buffer is disabled

On a Pluto (AD9363, axi-ad9361-dds) the TX output keeps transmitting the last DMA samples after the last
writer closes the buffer: a receiver on a cable sees the tone until the TX gain is lowered. The AXI DAC
data select (CHAN_CNTRL_7, regs 0x0418 and 0x0458) is set to DMA (0x2) when the buffer is enabled and stays there.

`dds_buffer_postdisable()` in cf_axi_dds_buffer_stream.c would set it back to DDS, but commit 331f56730c62
("iio: buffer-dma: sync write support with upstream", Dec 2023) switched the setup to
`devm_iio_dmaengine_buffer_setup_with_ops()` and dropped `indio_dev->setup_ops = &dds_buffer_setup_ops;`,
so preenable and postdisable never run. The patch restores the assignment after the buffer setup.

Tested on Pluto and Pluto+ with a 6.12.114 based tree (xlnx/release/v6.12.y-2026r1 + stable): tone while
writing 63 to 73 dB, data select 0x0 after the writer stops, only LO leakage (32 to 47 dB) left, two
start/stop cycles, both boards. Before the patch the data select stayed 0x2.
Workaround on an unpatched kernel: write 0 to both registers via debugfs direct_reg_access.
