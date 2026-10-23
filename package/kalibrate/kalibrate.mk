################################################################################
#
# KALIBRATE
#
################################################################################


# Branch: main (pinned 2026-03-22)
KALIBRATE_VERSION = 1062eeaaa8ab7c684171e3cb6b75ae52bd7e8c8c
KALIBRATE_SITE = https://github.com/F5OEO/kalibrate-hydrasdr/archive
KALIBRATE_SOURCE = $(KALIBRATE_VERSION).tar.gz
# built against the private libiio 0.26: kal uses the 0.x API
KALIBRATE_DEPENDENCIES = fftw-double libiio0
KALIBRATE_CONF_OPTS = \
	-DLIBIIO_INCLUDE_DIR=$(LIBIIO0_INCLUDEDIR) \
	-DLIBIIO_LIBRARY=$(LIBIIO0_LIBRARY) \
	$(LIBIIO0_CMAKE_LINKER_OPTS)
KALIBRATE_INSTALL_STAGING = YES
KALIBRATE_LICENSE = BSD-2.0
KALIBRATE_LICENSE_FILES = COPYING

$(eval $(cmake-package))

