################################################################################
#
# maia-httpd
#
################################################################################

# mbehn1976/maia-sdr test/orig-into-refactor-pr12: F5OEO main + PR 12 complex spectrometer,
# the Tezuka DDC routing toggle and waterfall UI are already in that tree (no package patches)
MAIA_HTTPD_VERSION = 415cea9c87c68646cb7f588c58f110c42a610097
MAIA_HTTPD_SITE = https://github.com/mbehn1976/maia-sdr/archive
MAIA_HTTPD_SOURCE = $(MAIA_HTTPD_VERSION).tar.gz
MAIA_HTTPD_DEPENDENCIES = host-openssl

# Use Buildroot's $(TARGET_CROSS) which expands to $(HOST_DIR)/bin/<prefix>-
# and adapts per toolchain: arm-none-linux-gnueabihf- for Arm GNU, or
# arm-linux- for Bootlin, or arm-buildroot-linux-gnueabihf- for internal.
# Cargo's OPENBLAS_CC / linker config need a full absolute path, not just
# the prefix, hence the gcc/gfortran suffix here.
MAIA_HTTPD_TOOLCHAIN_GCC = $(TARGET_CROSS)gcc
MAIA_HTTPD_TOOLCHAIN_GFORTRAN = $(TARGET_CROSS)gfortran



define MAIA_HTTPD_BUILD_CMDS
	cd $(@D)/maia-httpd && \
	PATH="$(HOST_DIR)/bin:$$PATH" \
	OPENSSL_DIR="$(HOST_DIR)" \
	OPENBLAS_TARGET=armv7 \
	OPENBLAS_HOSTCC=gcc \
	BINDGEN_EXTRA_CLANG_ARGS_armv7_unknown_linux_gnueabihf="--sysroot=$(HOST_DIR)/arm-buildroot-linux-gnueabihf/sysroot" \
	OPENBLAS_CC="$(MAIA_HTTPD_TOOLCHAIN_GCC)" \
	OPENBLAS_FC="$(MAIA_HTTPD_TOOLCHAIN_GFORTRAN)" \
	cargo build --release --target armv7-unknown-linux-gnueabihf \
		--config "target.armv7-unknown-linux-gnueabihf.linker=\"$(MAIA_HTTPD_TOOLCHAIN_GCC)\""
endef

define MAIA_HTTPD_INSTALL_TARGET_CMDS
	xz -f -k $(@D)/maia-httpd/target/armv7-unknown-linux-gnueabihf/release/maia-httpd
	$(INSTALL) -D \
		$(@D)/maia-httpd/target/armv7-unknown-linux-gnueabihf/release/maia-httpd.xz \
		$(TARGET_DIR)/usr/bin/
endef

$(eval $(generic-package))
