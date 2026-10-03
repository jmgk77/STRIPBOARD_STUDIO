# Test fixtures

## Standard test board — "pump shield"

The canonical board used to compare Solve / Balanced / Compact / Easy and to reproduce bugs.
This is the **pre-solve starting board**: `P1..P8` are already grouped (`group=G1`) but the
board has no cuts/jumpers yet. Run **Balanced / Compact / Easy** on it and check that the
terminal array slides as a rigid cluster (D8) without deforming.

Board: **36 x 27** — columns 1–36, rows `AA`…`D` (A at the bottom). `C` (`GPIO_EXP`) is locked;
all other parts are free, and `P1..P8` share `group=G1`.

```
shield  36x27  (cols 1-36, rows AA-D)
    000000000111111111122222222223333333
    123456789012345678901234567890123456
AA  ------------------------------------
 Z  --A-------B---------------I------E--
 Y  ------------------------------------
 X  --A-------B---------------I------E--
 W  ------------------------------------
 V  ------------------------------------
 U  ------------------------------------
 T  C-------------------------J------F--
 S  C-----------------------------------
 R  C----D-------D------------J------F--
 Q  C----D-------D----------------------
 P  C----D-------D----------------------
 O  C----D-------D----------------------
 N  C----D-------D------------K------G--
 M  C----D-------D----------------------
 L  C----D-------D------------K------G--
 K  C----D-------D----------------------
 J  -----D-------D----------------------
 I  ------------------------------------
 H  --------------------------L------H--
 G  ------------------------------------
 F  --------------------------L------H--
 E  ------------------------------------
 D  ------------------------------------
```

```
legend:  - copper strip   x cut   o jumper end   | jumper arc   M mounting hole

components:
  A ENTRADA_5V terminal2@(3,4) rot180  pins: 1=(3,X) "5v" 2=(3,Z) "GND"
  B ENTRADA_12V terminal2@(11,4) rot180  pins: 1=(11,X) "12V" 2=(11,Z) "GND"
  C GPIO_EXP custom-gpio-expander@(1,8) rot0 locked  pins: 1=(1,T) "VCC" 2=(1,S) "GND" 3=(1,R) "PB7" 4=(1,Q) "PB6" 5=(1,P) "PB5" 6=(1,O) "PB4" 7=(1,N) "PB3" 8=(1,M) "PB2" 9=(1,L) "PB1" 10=(1,K) "PB0"
  D DARLINTON_ARRAY custom-header@(6,10) rot0  pins: L1=(6,R) "1B" L2=(6,Q) "2B" L3=(6,P) "3B" L4=(6,O) "4B" L5=(6,N) "5B" L6=(6,M) "6B" L7=(6,L) "7B" L8=(6,K) "8B" L9=(6,J) "GND" R1=(14,R) "1C" R2=(14,Q) "2C" R3=(14,P) "3C" R4=(14,O) "4C" R5=(14,N) "5C" R6=(14,M) "6C" R7=(14,L) "7C" R8=(14,K) "8C" R9=(14,J) "COM"
  E P1 terminal2@(34,2) rot0 group=G1  pins: 1=(34,Z) "VCC" 2=(34,X) "PUMP1"
  F P2 terminal2@(34,8) rot0 group=G1  pins: 1=(34,T) "VCC" 2=(34,R) "PUMP2"
  G P3 terminal2@(34,14) rot0 group=G1  pins: 1=(34,N) "VCC" 2=(34,L) "PUMP3"
  H P4 terminal2@(34,20) rot0 group=G1  pins: 1=(34,H) "VCC" 2=(34,F) "PUMP4"
  I P5 terminal2@(27,2) rot0 group=G1  pins: 1=(27,Z) "VCC" 2=(27,X) "PUMP5"
  J P6 terminal2@(27,8) rot0 group=G1  pins: 1=(27,T) "VCC" 2=(27,R) "PUMP6"
  K P7 terminal2@(27,14) rot0 group=G1  pins: 1=(27,N) "VCC" 2=(27,L) "PUMP7"
  L P8 terminal2@(27,20) rot0 group=G1  pins: 1=(27,H) "VCC" 2=(27,F) "PUMP8"

nets:
  N1: ENTRADA_5V.5v, GPIO_EXP.VCC
  N2: DARLINTON_ARRAY.GND, ENTRADA_12V.GND, ENTRADA_5V.GND, GPIO_EXP.GND
  N4: DARLINTON_ARRAY.1C, P1.PUMP1
  N5: DARLINTON_ARRAY.2C, P2.PUMP2
  N6: DARLINTON_ARRAY.3C, P3.PUMP3
  N7: DARLINTON_ARRAY.4C, P4.PUMP4
  N11: DARLINTON_ARRAY.1B, GPIO_EXP.PB7
  N12: DARLINTON_ARRAY.2B, GPIO_EXP.PB6
  N13: DARLINTON_ARRAY.3B, GPIO_EXP.PB5
  N14: DARLINTON_ARRAY.4B, GPIO_EXP.PB4
  N15: DARLINTON_ARRAY.5B, GPIO_EXP.PB3
  N16: DARLINTON_ARRAY.6B, GPIO_EXP.PB2
  N17: DARLINTON_ARRAY.8B, GPIO_EXP.PB0
  N18: DARLINTON_ARRAY.7B, GPIO_EXP.PB1
  N8: DARLINTON_ARRAY.5C, P5.PUMP5
  N9: DARLINTON_ARRAY.6C, P6.PUMP6
  N10: DARLINTON_ARRAY.7C, P7.PUMP7
  N3: DARLINTON_ARRAY.COM, ENTRADA_12V.12V, P1.VCC, P2.VCC, P3.VCC, P4.VCC, P5.VCC, P6.VCC, P7.VCC, P8.VCC
  N19: DARLINTON_ARRAY.8C, P8.PUMP8

cuts (* = fixed): (none)
jumpers (* = fixed): (none)
mounting holes (Ø3.2mm): (none)
```

Notes:
- `P1`…`P8` are `terminal2` at x=27 and x=34, rows y=2/8/14/20 — the classic rigid cluster
  (`group=G1`, D8). Start here to validate that Optimize slides the array without deforming it.
- `GPIO_EXP` and `DARLINTON_ARRAY` are custom pin bars (`customParts`); `GPIO_EXP` is locked.
- 19 nets, 8 output terminals, 2 input terminals, 2 custom bars.
- After solving, the ASCII export also shows `x` cuts, `o`/`|` jumpers and `(* = fixed)`.

Update this block whenever the standard board changes.
