################################################################################
#
# SoapyPlutoSDR
#
################################################################################
SOAPYPLUTOSDR_VERSION = soapyplutosdr
SOAPYPLUTOSDR_SOURCE_BASENAME = SoapyPlutoPAPR-95f31398924e75a03a846a21c6d8e882ea5a10b4
SOAPYPLUTOSDR_SOURCE =$(SOAPYPLUTOSDR_SOURCE_BASENAME).zip
SOAPYPLUTOSDR_SITE = $(call github,F5OEO,SoapyPlutoPAPR,95f31398924e75a03a846a21c6d8e882ea5a10b4)
SOAPYPLUTOSDR_INSTALL_STAGING = YES
SOAPYPLUTOSDR_LICENSE = Boost Software License 1.0
SOAPYPLUTOSDR_LICENSE_FILES = LICENSE
# built against the private libiio 0.26: the plugin and libad9361-iio use the 0.x API
SOAPYPLUTOSDR_DEPENDENCIES = soapy-sdr libiio0 libad9361-iio
# CMake 4 refuses the cmake_minimum_required of this old project
SOAPYPLUTOSDR_CONF_OPTS = \
	-DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
	-DLibIIO_INCLUDE_DIR=$(LIBIIO0_INCLUDEDIR) \
	-DLibIIO_LIBRARY=$(LIBIIO0_LIBRARY) \
	$(LIBIIO0_CMAKE_LINKER_OPTS)
#SOAPYPLUTOSDR_MASTER_CONF_OPTS = -DENABLE_PYTHON3=OFF -DENABLE_PYTHON=OFF
# -DCFLAGS=$(TARGET_CC) -DCXXFLAGS=$(TARGET_CXX)

define SOAPYPLUTOSDR_EXTRACT_CMDS
    echo $(@D)
    unzip $(DL_DIR)/$(SOAPYPLUTOSDR_VERSION)/$(SOAPYPLUTOSDR_SOURCE_BASENAME).zip -d $(@D)
    mv $(@D)/$(SOAPYPLUTOSDR_SOURCE_BASENAME)/* $(@D)
 #   rmdir $(@D)/$(SOAPYPLUTOSDR_SOURCE_BASENAME)
endef

$(eval $(cmake-package))
