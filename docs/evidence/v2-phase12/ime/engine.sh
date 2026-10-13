#!/bin/bash
exec proot -b /workspace/.cache/milkup-ime-phase11/usr/lib/x86_64-linux-gnu/libpinyin:/usr/lib/x86_64-linux-gnu/libpinyin -b /workspace/.cache/milkup-ime-phase11/usr/share/ibus-libpinyin:/usr/share/ibus-libpinyin -b /workspace/.cache/milkup-ime-phase11/usr/share/opencc:/usr/share/opencc /workspace/.cache/milkup-ime-phase11/usr/libexec/ibus-engine-libpinyin --ibus --verbose
