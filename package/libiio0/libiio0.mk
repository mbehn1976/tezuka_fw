################################################################################
#
# libiio0
#
################################################################################

# libiio 0.26 as a private library for programs that use the 0.x API; the
# system libiio is 1.0 (patches/buildroot/0006-libiio-update-to-1.0.0.patch).
# Everything is installed under /usr/libiio0 so nothing of the system libiio
# is overwritten; the programs find the library through an rpath.
LIBIIO0_VERSION = 0.26
LIBIIO0_SOURCE = libiio-$(LIBIIO0_VERSION).tar.gz
LIBIIO0_SITE = $(call github,analogdevicesinc,libiio,v$(LIBIIO0_VERSION))
LIBIIO0_INSTALL_STAGING = YES
LIBIIO0_LICENSE = LGPL-2.1+
LIBIIO0_LICENSE_FILES = COPYING.txt

LIBIIO0_PREFIX = /usr/libiio0
# patchelf: board/tezuka/common/post-build.sh sets the rpath of plutotx
LIBIIO0_DEPENDENCIES = host-patchelf

LIBIIO0_CONF_OPTS = -DCMAKE_INSTALL_PREFIX=$(LIBIIO0_PREFIX) \
	-DENABLE_IPV6=ON \
	-DWITH_LOCAL_BACKEND=ON \
	-DWITH_NETWORK_BACKEND=ON \
	-DINSTALL_UDEV_RULE=OFF \
	-DWITH_TESTS=OFF \
	-DWITH_IIOD=OFF \
	-DWITH_IIOD_USBD=OFF \
	-DWITH_AIO=OFF \
	-DWITH_DOC=OFF \
	-DPYTHON_BINDINGS=OFF \
	-DCSHARP_BINDINGS=OFF \
	-DNO_THREADS=OFF

ifeq ($(BR2_PACKAGE_LIBIIO_XML_BACKEND),y)
LIBIIO0_DEPENDENCIES += libxml2
LIBIIO0_CONF_OPTS += -DWITH_XML_BACKEND=ON
else
LIBIIO0_CONF_OPTS += -DWITH_XML_BACKEND=OFF
endif

ifeq ($(BR2_PACKAGE_LIBIIO_USB_BACKEND),y)
LIBIIO0_DEPENDENCIES += libusb
LIBIIO0_CONF_OPTS += -DWITH_USB_BACKEND=ON
else
LIBIIO0_CONF_OPTS += -DWITH_USB_BACKEND=OFF
endif

ifeq ($(BR2_PACKAGE_LIBIIO_SERIAL_BACKEND),y)
LIBIIO0_DEPENDENCIES += libserialport
LIBIIO0_CONF_OPTS += -DWITH_SERIAL_BACKEND=ON
else
LIBIIO0_CONF_OPTS += -DWITH_SERIAL_BACKEND=OFF
endif

ifeq ($(BR2_PACKAGE_AVAHI_LIBAVAHI_CLIENT),y)
LIBIIO0_DEPENDENCIES += avahi
LIBIIO0_CONF_OPTS += -DHAVE_DNS_SD=ON
else
LIBIIO0_CONF_OPTS += -DHAVE_DNS_SD=OFF
endif

# only the shared library goes to the target
define LIBIIO0_REMOVE_DEV_FILES_TARGET
	rm -rf $(TARGET_DIR)$(LIBIIO0_PREFIX)/include \
		$(TARGET_DIR)$(LIBIIO0_PREFIX)/lib/pkgconfig \
		$(TARGET_DIR)$(LIBIIO0_PREFIX)/lib/libiio.so \
		$(TARGET_DIR)$(LIBIIO0_PREFIX)/bin \
		$(TARGET_DIR)$(LIBIIO0_PREFIX)/sbin
endef
LIBIIO0_POST_INSTALL_TARGET_HOOKS += LIBIIO0_REMOVE_DEV_FILES_TARGET

# Variables for the packages built against libiio0: the include directory,
# the library and a linker flag that finds the library at run time.
LIBIIO0_INCLUDEDIR = $(STAGING_DIR)$(LIBIIO0_PREFIX)/include
LIBIIO0_LIBRARY = $(STAGING_DIR)$(LIBIIO0_PREFIX)/lib/libiio.so
LIBIIO0_RPATH = -Wl,-rpath,$(LIBIIO0_PREFIX)/lib
# the linker flags go to CMake as a whole, so they repeat Buildroot's own
LIBIIO0_CMAKE_LINKER_OPTS = \
	-DCMAKE_EXE_LINKER_FLAGS="$(TARGET_LDFLAGS) $(LIBIIO0_RPATH)" \
	-DCMAKE_SHARED_LINKER_FLAGS="$(TARGET_LDFLAGS) $(LIBIIO0_RPATH)" \
	-DCMAKE_MODULE_LINKER_FLAGS="$(TARGET_LDFLAGS) $(LIBIIO0_RPATH)"

$(eval $(cmake-package))
