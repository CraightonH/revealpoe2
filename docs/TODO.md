1. Make a Build Planner (save groups of items, skills, supports, etc.)
2. Make an Item Crafter
3. Expand Theory Craft page to allow pinning items across searches
4. All tooltips/cards get clickable icons for: 1. Add to Theory Craft
5. Add passive tree controls inside canvas - weapon set selector, search bar, etc.
6. [DONE] Increase pan speed of passive tree
7. [DONE] Mastery nodes are animation toggles. When a connecting node is activated, the in-game tree activates the mastery node automatically which just adds a backlight and some texture for impact. Remove those from the tree as they're not selectable in game. (Masteries are dropped in scripts/graph/gggTree.js.) Future work can add the same in-game animation to our tree if we want.
8. [DONE] Pull passive tree artwork (node borders, class art, ascendancy art). Resize tree to fit into artwork ratios. (Done via GGG's official tree data + sprite atlases — see docs/passive-tree.md. Node frames/icons, connector arcs, and the centre class illustration + frame all render from GGG art at native ratios.)
9. Hide all ascendancies, add class/ascendancy selector so that when class is selected, class art is in center of tree. When ascendancy is selected, replace class art with ascendancy art and move ascendancy tree into center of tree. Start node should align properly to class start node. (Foundation ready: GGG data carries per-class/ascendancy art + offsets and classStarts; activeClass is currently hard-coded to Monk in public/js/passive-tree.js.)
