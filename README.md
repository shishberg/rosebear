# Rosebear

Rosebear is a 5x3+3 wireless split keyboard designed with [Ergogen](https://ergogen.xyz/). ZMK firmware is at https://github.com/shishberg/rosebear-zmk.

Thanks to [Ben Vallack](https://www.youtube.com/watch?v=M_VuXVErD6E) and [FlatFootFox](https://flatfootfox.com/ergogen-part5-kicad-firmware-assembly/) for the tutorials that made this even vaguely possible.

![The assembled Rosebear split keyboard.](https://github.com/shishberg/rosebear/assets/12688008/9735eabc-7018-48e4-b3d0-37bc83f5b572)

![Screenshot of the Rosebear PCB in KiCad.](https://github.com/shishberg/rosebear/assets/12688008/17c755e5-44c8-47f2-8217-febceaac0dab)

## Features
- Pretty aggressive stagger on the pinky column, and splay on pinky and ring columns
- Thumb cluster is waaaaay over there
- Direct pin wiring - no diodes
- Kailh choc switches - supports hotswap or soldered
- Bluetooth only (there aren't any pins available for a cable between the two sides)

## Lessons learnt
- Don't use a JST connector for the battery. Just don't. You don't need to. Crimping is fiddly as hell (I don't have a crimper and don't really want to buy one). Even if the battery comes with one, it's annoying as hell to unplug. Just solder the battery terminals on. If you want to replace or reuse the battery, unsoldering two wires is trivial.
  - I used a JST connector on the left board, but it was too hard so for the right board I just soldered the battery on. That was so much easier that it made me so mad that I unsoldered the connector from the left board, which was harder again; and then I soldered the battery in the wrong way around, which nearly burned out the nice!nano.
  - The picture above doesn't have a reset button because they haven't arrived yet.
- There _might_ be such a thing as too much pinky stagger. Or I might just need longer to get used to it.
- If you're not going to use a bottom plate, it would help to plan some empty spaces to put rubber feet.
  - PCBs don't come perfectly flat. If you're going to use rubber feet, you either need to use exactly three (and the triangle they form needs to cover all the keys or it'll rock when you press a key outside it); or you need to adjust their height (which I ended up doing with some ~1mm thick two-sided adhesive dots that I happened to have)
- I do like having the thumb cluster further out. I intended for the middle thumb key to be the "home" key (space and enter for me) and the one you have to stretch for can be something less common (esc and del). That's fine, but I should have made middle key 1.5u so it's easy to find.
- Choc pinks are so light they almost type by themselves under the weight of keycaps. I'd used dark yellows before and found them too heavy. Reds are about right.
- Choc keycaps could do with a bit of spacing between them vertically. Especially with very light switches, it's too easy to accidentally brush another key.
