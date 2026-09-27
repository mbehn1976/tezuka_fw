#!/usr/bin/env bash
# Health check for physical test boards: network reachability, IIO context,
# SSH-reported firmware version/uptime, Dashboard HTTP status, and a real
# rendered screenshot of the Dashboard via headless Chrome (catches JS
# errors/blank pages that a plain curl 200 wouldn't).
#
# Usage:
#   tools/check_boards.sh                  # check all boards below
#   tools/check_boards.sh pluto plutoplus  # check specific boards
#
# Requires: iio_info, sshpass, curl, google-chrome-stable (or set CHROME_BIN)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${CHECK_BOARDS_OUT_DIR:-/tmp/check_boards}"
CHROME_BIN="${CHROME_BIN:-google-chrome-stable}"
SSH_PASS="${BOARD_SSH_PASS:-analog}"

declare -A BOARD_HOST=(
    [pluto]="pluto.local"
    [plutoplus]="plutoplus.local"
)

mkdir -p "${OUT_DIR}"

BOARDS=("$@")
[ ${#BOARDS[@]} -eq 0 ] && BOARDS=("${!BOARD_HOST[@]}")

overall_status=0

check_board() {
    local board="$1"
    local host="${BOARD_HOST[$board]:-}"
    if [ -z "$host" ]; then
        echo "ERROR: unknown board '${board}' (known: ${!BOARD_HOST[*]})"
        overall_status=1
        return
    fi

    echo "=== ${board} (${host}) ==="

    # 1. Ping
    if ping -c1 -W2 "${host}" >/dev/null 2>&1; then
        echo "  [ok]   ping"
    else
        echo "  [FAIL] ping"
        overall_status=1
        echo
        return
    fi

    # 2. IIO context
    if iio_info -u "ip:${host}" >/dev/null 2>&1; then
        hw_model=$(iio_info -u "ip:${host}" 2>/dev/null | grep -m1 "hw_model:" | sed 's/.*hw_model: //')
        echo "  [ok]   iio context (${hw_model})"
    else
        echo "  [FAIL] iio context"
        overall_status=1
    fi

    # 3. SSH: firmware version + uptime
    ssh_out=$(sshpass -p "${SSH_PASS}" ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 \
        "root@${host}" "cat /etc/os-release; uptime" 2>/dev/null)
    if [ -n "$ssh_out" ]; then
        version=$(echo "$ssh_out" | sed -n 's/^VERSION=//p')
        uptime_line=$(echo "$ssh_out" | grep "load average")
        echo "  [ok]   ssh (firmware ${version}, ${uptime_line# })"
    else
        echo "  [FAIL] ssh"
        overall_status=1
    fi

    # 4. Dashboard HTTP check
    http_code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "http://${host}/" 2>/dev/null)
    if [ "$http_code" = "200" ]; then
        echo "  [ok]   dashboard http (200)"
    else
        echo "  [FAIL] dashboard http (${http_code:-no response})"
        overall_status=1
    fi

    # 5. Headless Chrome: real render + console errors
    local shot="${OUT_DIR}/${board}.png"
    local console_log="${OUT_DIR}/${board}-console.log"
    if command -v "${CHROME_BIN}" >/dev/null 2>&1; then
        "${CHROME_BIN}" --headless=new --disable-gpu --no-sandbox \
            --window-size=1280,900 --virtual-time-budget=6000 \
            --enable-logging=stderr --v=1 \
            --screenshot="${shot}" \
            "http://${host}/" >"${console_log}" 2>&1

        if [ -s "${shot}" ]; then
            echo "  [ok]   chrome render -> ${shot}"
        else
            echo "  [FAIL] chrome render (no screenshot produced)"
            overall_status=1
        fi

        # JS runtime errors show up as "console-error" or "Uncaught" in
        # --enable-logging output; ignore devtools/network noise.
        js_errors=$(grep -iE "console-error|uncaught (exception|reference|type)error" "${console_log}" || true)
        if [ -n "$js_errors" ]; then
            echo "  [WARN] JS console errors (see ${console_log}):"
            echo "$js_errors" | sed 's/^/           /'
        else
            echo "  [ok]   no JS console errors"
        fi
    else
        echo "  [skip] chrome not found (\$CHROME_BIN=${CHROME_BIN})"
    fi

    echo
}

for b in "${BOARDS[@]}"; do
    check_board "$b"
done

exit $overall_status
