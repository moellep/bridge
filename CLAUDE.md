# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Contents

This is a reverse-engineering project for an Atari 2600 Bridge game ROM.

- `bridge.bin` — 4096-byte Atari 2600 ROM (MOS 6507 CPU, mapped $F000–$FFFF, reset vector → $F000)
- `bidding.md` — Full disassembly and analysis of the bidding system

## Working with the ROM

Disassemble with Python (no external tools required):

```bash
# Full disassembly to stdout
python3 -c "
import sys
data = open('bridge.bin','rb').read()
# ... 6502 opcode table and formatter
"
```

The full annotated disassembler used during analysis is embedded in the conversation history. To re-run it, reconstruct from the opcode table in `bidding.md` or use any 6502 disassembler with base address `$F000`.

Inspect raw bytes:
```bash
python3 -c "
data = open('bridge.bin','rb').read()
for i in range(0, len(data), 16):
    row = data[i:i+16]
    print(f'{0xF000+i:04X}  {\" \".join(f\"{b:02X}\" for b in row)}')
"
```

## Architecture

The ROM is 4KB of 6507 machine code with no external dependencies. All state lives in the Atari 2600's 128 bytes of RAM (`$00`–`$7F`) plus TIA/RIOT registers. Key regions:

- **$F000–$F100**: Reset/init, main VSYNC loop
- **$F100–$F300**: Opening bid evaluation
- **$F300–$F500**: Response and rebid logic, hand evaluation entry points
- **$F500–$F700**: AI bidding engine (four sub-functions: `AI_bid_start`, `AI_bid_2`, `AI_bid_3`, `AI_bid_4`)
- **$F700–$F900**: Hand/suit evaluation routines
- **$F900–$FB00**: Game/scoring logic
- **$FB00–$FD00**: Card play routines
- **$FD00–$FF00**: Utility subroutines and display
- **$FF00–$FFFF**: Character bitmaps (doubles as HCP lookup table), ROM tables, interrupt vectors

See `bidding.md` for the complete bidding system analysis including card encoding, bid encoding, HCP counting, and the Blackwood ace-counting implementation.

## Key Data Structures

**Card byte** (`$0098`–`$00CB`):
- Bit 7: 0 = in this player's hand, 1 = not held
- Bits 6:0: `rank*8 + suit` (suit: ♣=0 ♦=1 ♥=2 ♠=3; rank: 2–14)
- Honor threshold: cards ≥ `$50` (rank 10+) yield HCP = `(value − $50) >> 3`

**Bid byte** (`$87`, `$88`–`$8B`): `(level−1)*8 + suit_code` where ♣=0 ♦=1 ♥=2 ♠=3 NT=4 PASS=5. Max bid 7NT = `$34`.

**Player hands**: 13 cards each at RAM offsets 0, 13, 26, 39 from `$0098` (see `$FFC0` table).
