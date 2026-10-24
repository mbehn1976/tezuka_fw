#!/bin/sh
# Boot-time RF defaults for cabled link tests:
# 2.5 MS/s, 2.5 MHz RF bandwidth, 2.4 GHz LO on both directions, TX gain 0 dB,
# manual RX gain (40 dB on Pluto+, 55 dB on original Pluto).
# Runs before api_controller so the controller starts from these values.
# Always exits 0 so a failure here never blocks boot.

LOG=/tmp/test_defaults.log
P=ad9361-phy

model=$(tr -d '\0' < /proc/device-tree/model 2>/dev/null)
case "$model" in
  *Pluto+*) RX_GAIN=40 ;;
  *)        RX_GAIN=55 ;;
esac

i=0
until iio_attr -c $P >/dev/null 2>&1 || [ $i -ge 30 ]; do
  sleep 1; i=$((i+1))
done

{
  echo "model=$model rx_gain=$RX_GAIN"
  iio_attr -c $P voltage0 sampling_frequency 2500000
  iio_attr -c $P voltage0 rf_bandwidth 2500000
  iio_attr -c $P -o voltage0 rf_bandwidth 2500000
  iio_attr -c $P -o voltage0 hardwaregain 0
  iio_attr -c $P altvoltage0 frequency 2400000000
  iio_attr -c $P -o altvoltage1 frequency 2400000000
  iio_attr -c $P voltage0 gain_control_mode manual
  iio_attr -c $P -i voltage0 hardwaregain $RX_GAIN
} >> $LOG 2>&1

exit 0
