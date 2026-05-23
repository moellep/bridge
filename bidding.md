# Atari 2600 `bridge.bin` — Disassembly & Bidding System Analysis

**Platform:** Atari 2600, MOS 6507 CPU (6502 variant)  
**ROM:** 4096 bytes, mapped $F000–$FFFF. Reset vector at $FFFC → $F000.

---

## Card Encoding

Each of the 52 cards is a single byte stored in RAM at `$0098`–`$00CB` (13 cards per player):

```
Card byte:
  Bit  7   : 0 = card in this player's hand; 1 = not held (dealt elsewhere / played)
  Bits 6:0 : card identity = rank*8 + suit
              suit: 0=♣  1=♦  2=♥  3=♠
              rank: 2–14  (2=2, 3=3, … 10=10, 11=J, 12=Q, 13=K, 14=A)

Examples:
  2♣ = $10   3♣ = $18   10♣ = $50   J♣ = $58   Q♣ = $60   K♣ = $68   A♣ = $70
  2♠ = $13   10♠= $53   J♠ = $5B   Q♠ = $63   K♠ = $6B   A♠ = $73
```

Player hand offsets (from the `$FFC0` table — values 0, 13, 26, 39):

| Player | RAM range        |
|--------|-----------------|
| 0 (N)  | `$0098`–`$00A4` |
| 1 (E)  | `$00A5`–`$00B1` |
| 2 (S)  | `$00B2`–`$00BE` |
| 3 (W)  | `$00BF`–`$00CB` |

---

## Bid Encoding

Every bid is stored as a single byte using the formula:

```
bid_byte = (level − 1) × 8  +  suit_code
           where  ♣=0  ♦=1  ♥=2  ♠=3  NT=4   PASS=5
```

```
1♣=$00  1♦=$01  1♥=$02  1♠=$03  1NT=$04
2♣=$08  2♦=$09  2♥=$0A  2♠=$0B  2NT=$0C
3♣=$10  …
4♣=$18  4♥=$1A  …
7♣=$30  7♦=$31  7♥=$32  7♠=$33  7NT=$34  (max bid = 52)
PASS = 5 (special sentinel)
```

The current bid is tracked in `$87`. Each player's last bid is in `$88`–`$8B` (indexed by player number).

---

## Honor Point Counting — `sub_FDB0` ($FDB0)

This is the core hand evaluator. Called before every bid decision. It iterates through all 13 cards of the current player and:

**1. Counts cards per suit** — stored in `$E4` (♣), `$E5` (♦), `$E6` (♥), `$E7` (♠).

**2. Accumulates honor points per suit** — stored in `$EC`–`$EF`.

The honor calculation is a three-instruction trick at `$FDE7`:

```asm
SBC  #$50        ; subtract 80 (the value of 10♣)
BCC  $FDF3       ; skip if card rank < 10 (no HCP)
LSR              ; ÷ 2
LSR              ; ÷ 4
LSR              ; ÷ 8  →  (card_value − 80) / 8
CLC
ADC  $EC,X       ; add to honor total for this suit
STA  $EC,X
```

Because each honor rank is spaced 8 apart in the card encoding:

| Card | Value | `value − $50` | `÷ 8` = HCP |
|------|-------|----------------|-------------|
| 10   | $50   | 0              | 0 (skipped by BCC) |
| J    | $58   | 8              | **1** |
| Q    | $60   | 16             | **2** |
| K    | $68   | 24             | **3** |
| A    | $70   | 32             | **4** |

These are exactly the standard bridge High Card Points (HCP). Total HCP for the hand is accumulated into `$82`.

---

## The Bidding Engine

After hand evaluation, control flows through four AI functions depending on hand strength and auction position:

### Step 1 — `bid_notrump_check` ($F326, called at reset and new deal)

```asm
F326  JSR $FE88    ; initialize/shuffle the deck (LFSR-based RNG via $F9/$FA/$FB)
F329  INX
F32A  STX $F6      ; store round number
F32F  ADC #$08     ; build $85 = positional hand strength factor
F337  STA $85
```

Sets up the deal, initializes `$85` (an adjustment for seat position) and jumps to the card play / bid dispatch.

---

### Step 2 — Hand evaluation & opening bid decision ($F1C6–$F2DE)

```asm
F1C6  LDA $F6         ; current round/deal number
F1CE  JSR $FDB0       ; ← HAND EVALUATOR: fills $82 (HCP), $E4-$EF (per-suit counts)
F1D1  LDA #$FF
F1D3  BIT $83         ; test game state
F1D5  BPL $F247       ; branch if not opening bidder
F1D7  BVC $F1E2       ; overflow test (is partner's bid known?)
F1E2  STA $CC         ; set pass marker
```

If opening:
```asm
F200  JSR $FCE5       ; get next legal bid above current auction
F207  CMP #$05        ; is it PASS?
F20B  STA $DF         ; store HCP distribution count
F215  AND #$10        ; check if partner has shown a suit
F228  ADC $FFA0,Y     ; add distribution adjustment (Y=0 or 16 for NT vs suit)
F22E  CMP #$35        ; if adjusted HCP ≥ 53 (too high), pass
F232  CMP $DF         ; compare to best previous bid value
F236  AND #$07        ; isolate suit bits
F239  CMP #$05        ; check for NT threshold
```

The opening bid logic weighs **total HCP** (`$82`) against a **minimum opening threshold** (~13 HCP). If strong enough, it calls `sub_FCE5` to find the lowest legal bid in the best suit.

---

### `sub_FCE5` — Next Legal Bid ($FCE5)

Cycles through bids in order, wrapping from NT to Clubs at the next level:

```asm
FCE5  LDX $80          ; X = current player
FCE7  LDA $88,X        ; load player's current bid
FCE9  CMP #$34         ; at 7NT (max bid)?
FCEB  BCC $FCF0        ; no → try to increment
FCED  LDA #$05         ; yes → return PASS
FCEF  RTS
FCF0  ADC #$01         ; try next bid
FCF2  AND #$07         ; mod 8 (5 suits + PASS wraps to 0)
FCF4  CMP #$05         ; hit NT+1 (would-be suit 5)?
FCF6  BCC $FCFC        ; valid suit (0-4) → return
FCF8  BNE $FCED        ; > 5 (suit 6-7) → force PASS
FCFA  LDA #$00         ; = 5 means wrap: next level, start at ♣=0
```

---

### Step 3 — Response logic, `AI_bid_2` ($F5F3)

Called when the AI is responding to partner's bid. The combined partnership strength drives the auction level:

```asm
F5F3  LDA $88          ; current bid encoding
F5F5  AND #$18         ; extract bid-level group (bits 4:3)
F5F7  TAY              ; Y = 0, 8, 16, or 24
F5F8  LDX $82          ; X = own HCP
F5FA  JSR $FD40        ; compute F1=high range, F2=low range from tables $FF00/$FF40
F5FD  LDA $DF          ; combined (own + estimated partner) HCP
F5FF  ADC $FF40,Y      ; add level-based constant
F602  CMP $F1          ; compare to high range
F608  CMP #$21         ; compare to 33 = small slam threshold
F610  CMP #$1A         ; compare to 26 = game threshold
```

Point decisions:

| Combined HCP (`$DF`) | Action |
|---------------------|--------|
| < 16                | Part score, bid minimum |
| 16–25               | Invitational — try for game |
| ≥ 26 (`$1A`)        | **Bid game** (4♥/4♠ or 3NT) |
| ≥ 33 (`$21`)        | **Bid slam** (6x) |

---

### `sub_FD40` — Point Range Calculator ($FD40)

Produces minimum/maximum HCP ranges for a given bid level. It reuses the **character bitmap data** at `$FF00`/`$FF40` (a 4KB-ROM space trick where the digit sprite bytes double as lookup values):

```asm
FD40  CLC
FD41  TXA
FD42  ADC $FF00,Y     ; F2 = own HCP + table_low[level]
FD45  STA $F2
FD47  TXA
FD48  ADC $FF40,Y     ; F1 = own HCP + table_high[level]
FD4B  STA $F1
```

Level thresholds (Y = bits 4:3 of current bid byte):

| Y  | `$FF00+Y` | `$FF40+Y` | Meaning |
|----|-----------|-----------|---------|
| 0  | 16        | 18        | 1-level (minimum opening) |
| 8  | 22        | 24        | 2-level |
| 16 | 25        | 27        | 3-level |
| 24 | 22        | 25        | No-Trump bids |

---

### Step 4 — Rebid / slam try, `AI_bid_3` ($F64D) and `AI_bid_4` ($F687)

**`AI_bid_3`** handles rebids after partner responds:

```asm
F64D  JSR $FCFC        ; evaluate suit quality (card count + honor strength)
F650  CMP #$18         ; compare to 24
F654  LDY $F1          ; load high point range
F656  CPY #$21         ; 33 HCP = slam?
F65B  ADC #$08         ; adjust bid level up
F65D  JMP $F8BA        ; → commit bid
```

**`AI_bid_4`** ($F687) handles slam investigation. It checks if combined strength justifies a 6-level or 7-level bid:

```asm
F687  LDA $88,X        ; load current high bid
F68B  CMP #$1C         ; $1C = 4NT (Blackwood ask!)
F68F  BEQ $F69D        ; yes → count aces via sub_FD4E
F691  LDY $86,X        ; check partner's last bid
F693  CPY #$1C         ; did partner bid 4NT?
F697  LDY #$68         ; set Y = $68 (slam response flag)
F699  CMP #$24         ; is our bid 5NT (King ask)?
F6A0  JSR $FD4E        ; ace/king counting
```

**`sub_FD4E`** ($FD4E) — **Ace counting (Blackwood)**:

```asm
FD4E  STY $E1          ; save query value ($68=aces, $70=kings)
FD50  LDX #$0C         ; loop through 13 card slots
FD54  LDA $98,X        ; load card
FD56  AND #$78         ; mask suit + high rank bits
FD58  CMP $E1          ; does it match ace/king pattern?
FD5A  BNE $FD5D
FD5C  INY              ; count matching honors
FD5D  DEX
FD5E  BPL $FD54        ; loop all 13 cards
FD60  TYA              ; A = count of aces (or kings)
FD61  LDX $80          ; current player
FD63  ADC $88,X        ; add to current bid
FD66  AND #$03         ; constrain to 0-3 range (0-3 aces)
```

The Blackwood 4NT response encodes ace count directly in the bid level: 5♣=0 aces, 5♦=1 ace, 5♥=2 aces, 5♠=3 aces.

---

### Step 5 — `sub_FE68` — Commit a bid ($FE68)

Once a bid is decided, this routine stores it and advances the auction:

```asm
FE68  STX $F8          ; save bid state
FE6A  STX $83          ; update game state
FE6C  LDX $80          ; current player
FE6E  INX              ; next player
FE6F  CPX #$0C         ; wrapped around?
FE71  BCC $FE79
FE73  LDX $93          ; wrap to stored base
FE77  LDX #$0A
FE79  STX $80          ; advance current player pointer
FE7B  STA $88,X        ; store bid in player's bid slot
FE7E  ADC #$08         ; bump bid level
FE80  STA $0094,Y      ; update display buffer
```

---

## Complete Bidding Flow

```
RESET ($F000)
  │  zero all RAM
  └─► bid_notrump_check ($F326)
        │  shuffle deck via LFSR RNG
        └─► score_calc / FCB2 dispatch
              │
              ▼
        MAIN_LOOP ($F00E)  ──── wait for VSYNC ($0284)
              │
              ▼
        sub_FDB0 ($FDB0)   ←── HAND EVALUATOR
              │  for each of 13 cards:
              │    suit = card & 3  →  $E4[suit]++
              │    if card >= $50:  HCP += (card−$50)>>3  →  $EC[suit]
              │  total HCP → $82
              │
              ▼
        Opening bid decision ($F1C6)
              │  if HCP($82) ≥ 13 → find lowest bid via sub_FCE5
              │  else → PASS
              │
              ▼
        Response: AI_bid_2 ($F5F3)
              │  combined HCP < 26 → part score bid
              │  combined HCP ≥ 26 → game bid
              │  combined HCP ≥ 33 → slam bid
              │
              ▼
        Rebid: AI_bid_3 ($F64D) / AI_bid_4 ($F687)
              │  if 4NT bid detected → sub_FD4E (Blackwood ace count)
              │  if 5NT bid detected → sub_FD4E (King count)
              │  else → suit quality via sub_FCFC
              │
              ▼
        sub_FE68 ($FE68)
              │  store bid in $88+player
              │  advance player pointer in $80
              └─► display update → card play phase
```

---

## Key Zero-Page Variables

| Address    | Purpose |
|-----------|---------|
| `$80`     | Current player index (0–3: N, E, S, W) |
| `$82`     | Total HCP for current player |
| `$83`     | Game state / current bid level byte |
| `$84`     | Bid round counter |
| `$85`     | Positional hand strength adjustment |
| `$86`     | Game mode flags (bit 7 = vs computer) |
| `$87`     | Current bid value `(level−1)×8 + suit` |
| `$88–$8B` | Per-player bid values (same encoding) |
| `$E4–$E7` | Card count per suit (♣♦♥♠) |
| `$E8–$EB` | Highest card index per suit |
| `$EC–$EF` | Honor points per suit |
| `$F1`     | High point threshold (from `sub_FD40`) |
| `$F2`     | Low point threshold (from `sub_FD40`) |
| `$F4`     | Best suit index (longest/strongest) |
| `$F5`     | Second-best suit index |
| `$F6`     | Deal round number / LFSR state |
| `$F7`     | Bidding history flags |
| `$F8`     | Bid/auction state flag |
| `$F9`     | RNG state byte for card shuffling |
| `$DE/$DF` | Distribution points / short suit values |

---

## Notable Implementation Details

- **4KB code budget**: The digit sprite bitmaps at `$FF00`/`$FF40` are simultaneously used as HCP lookup tables — the numeric values embedded in the font patterns happen to match the point thresholds needed, almost certainly by design.
- **No division instruction**: All HCP arithmetic uses only 8-bit integers. The rank×8 card encoding lets three `LSR` instructions replace a division by 8, yielding A=4, K=3, Q=2, J=1 in five bytes of code.
- **LFSR shuffle**: The deck is shuffled using a multi-byte linear feedback shift register in `$FA`/`$FB` (updated in `sub_FECC` at $FECC). The RIOT timer at `$0C` provides entropy seeding.
- **Blackwood in 28 bytes**: The entire 4NT Blackwood convention (ask for aces, receive encoded count) fits in `sub_FD4E` — 28 bytes of 6507 code.
- **Bid cycling via modular arithmetic**: `sub_FCE5` uses `ADC #$01, AND #$07` to step through the 5 suit codes (0–4) and wrap correctly from NT back to Clubs at the next level — no branch table needed.
