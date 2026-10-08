#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOOLCHAIN_DIR="${OO_PS4_TOOLCHAIN:-$HOME/OpenOrbis/OpenOrbis/PS4Toolchain}"
LLVM_DIR="/opt/homebrew/opt/llvm"

export OO_PS4_TOOLCHAIN="$TOOLCHAIN_DIR"

CLANG="$LLVM_DIR/bin/clang"
if [ ! -f "$CLANG" ]; then
    CLANG="/usr/bin/clang"
fi

LLD="$LLVM_DIR/bin/ld.lld"
if [ ! -f "$LLD" ]; then
    LLD="/opt/homebrew/bin/ld.lld"
fi

CREATE_FSELF="$TOOLCHAIN_DIR/bin/macos/create-fself-macos"

OUTPUT_DIR="$SCRIPT_DIR/.."
BUILD_DIR="$SCRIPT_DIR/build"
mkdir -p "$BUILD_DIR"

echo "=== Building pad_stream.prx for PlayStation 4 (GoldHEN) ==="
echo "Compiler:     $CLANG"
echo "Linker:       $LLD"
echo "Toolchain:    $TOOLCHAIN_DIR"
echo "Create-FSELF: $CREATE_FSELF"

# 1. Compile C sources to object files
echo "[1/3] Compiling C source files..."

compile_src() {
    "$CLANG" --target=x86_64-pc-freebsd12-elf -fPIC -funwind-tables -c -D__ORBIS__=1 -O2 -Wall \
        -isysroot "$TOOLCHAIN_DIR" -isystem "$TOOLCHAIN_DIR/include" -I"$SCRIPT_DIR/include" \
        "$1" -o "$2"
}

compile_src "$SCRIPT_DIR/src/main.c"       "$BUILD_DIR/main.o"
compile_src "$SCRIPT_DIR/src/config.c"     "$BUILD_DIR/config.o"
compile_src "$SCRIPT_DIR/src/udp_sender.c" "$BUILD_DIR/udp_sender.o"
compile_src "$SCRIPT_DIR/src/pad_hook.c"   "$BUILD_DIR/pad_hook.o"

# 2. Link ELF shared library using official OpenOrbis linker script
echo "[2/3] Linking PS4 library (ELF) with link.x..."

"$LLD" -m elf_x86_64 -pie --export-dynamic \
     --script "$TOOLCHAIN_DIR/link.x" \
     --eh-frame-hdr \
     -L"$TOOLCHAIN_DIR/lib" \
     "$BUILD_DIR/main.o" \
     "$BUILD_DIR/config.o" \
     "$BUILD_DIR/udp_sender.o" \
     "$BUILD_DIR/pad_hook.o" \
     -lkernel -lScePad -lSceUserService -lSceNet -lSceSysUtil -lScePosix -lc \
     -o "$BUILD_DIR/pad_stream.elf"

# 3. Create signed FSELF/OELF using official OpenOrbis create-fself tool
echo "[3/3] Creating FSELF module (pad_stream.prx) via create-fself..."
"$CREATE_FSELF" \
    -in "$BUILD_DIR/pad_stream.elf" \
    -out "$BUILD_DIR/pad_stream.oelf" \
    --lib="$OUTPUT_DIR/pad_stream.prx" \
    --paid 0x3800000000000011

echo ""
echo "✓ BUILD SUCCESSFUL!"
echo "Generated plugin binary: $OUTPUT_DIR/pad_stream.prx"
