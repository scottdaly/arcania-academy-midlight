// Master palette (team: art+fx). Every sprite, tile and icon pulls from these ramps so the
// whole game reads as one cohesive set. Ramps run dark -> light.
export const INK = '#140c1c';
export const OUTLINE = '#140c1c';

export const P = {
  ink: INK, night: '#0b0716', void: '#05030a', white: '#f4f0ff', cream: '#fff4d6',
  shadow: 'rgba(8,4,20,0.38)',
  gold: ['#5a3410', '#a8641a', '#e0a030', '#ffd25a', '#fff2a8'],
  skin: ['#6a3a2a', '#b06a4a', '#e8a07a', '#f8c8a0', '#fff0dc'],
  skinDark: ['#3a1e14', '#6a3a24', '#9a5a38', '#c88a5a', '#e8b890'],
  hairBrown: ['#2a160c', '#4a2a16', '#7a4a24', '#a8703a', '#d0a060'],
  hairRed: ['#3a0e0a', '#7a2214', '#c0441e', '#ea7a3a', '#ffb070'],
  hairBlond: ['#5a3a10', '#a8782a', '#e0b44a', '#f8dc80', '#fff4c0'],
  hairWhite: ['#5a5a7a', '#9a9ab8', '#d0d0e4', '#ecebf6', '#ffffff'],
  hairBlack: ['#0a0812', '#1c1626', '#2e2638', '#4a4058', '#6a6078'],
  robeBlue: ['#141040', '#251f78', '#3d36b0', '#5a5ae0', '#8e9aff'],
  robeViolet: ['#1e0a3a', '#3a1670', '#5e2aa8', '#8a4ad8', '#c08aff'],
  robeGreen: ['#0c2418', '#164030', '#24644a', '#3a9068', '#7ac898'],
  robeRed: ['#2a0810', '#5a1420', '#9a2432', '#cc3a44', '#ff7a70'],
  robeWhite: ['#4a4a6a', '#8a8aa8', '#c8c8dc', '#e8e8f4', '#ffffff'],
  robeBrown: ['#24140a', '#4a2a14', '#7a4a24', '#a86a3a', '#d09a60'],
  robeTeal: ['#082a2e', '#0e4a50', '#16767a', '#2aa8a0', '#7ae0d0'],
  leather: ['#24140c', '#4a2a16', '#6e4020', '#96602e', '#c08a4a'],
  wood: ['#24140c', '#4a2c18', '#74482a', '#a06a3c', '#c8925a'],
  woodDark: ['#140a08', '#2a1810', '#442818', '#603a22', '#80542e'],
  steel: ['#1a1a2a', '#3a3a52', '#626a84', '#9aa4bc', '#dce4f4'],
  brass: ['#3a2410', '#6a4818', '#a8782a', '#d8aa48', '#fff0a0'],
  stone: ['#16131f', '#2c2838', '#48435a', '#6c6782', '#9a95ae', '#cac6da'],
  stoneWarm: ['#1e1612', '#3a2c24', '#5c4a3c', '#84705a', '#b09c80', '#dccab0'],
  marble: ['#5a5670', '#8c88a4', '#b8b4cc', '#dad6e8', '#f2f0fa'],
  brick: ['#2a0e10', '#4e1c1c', '#7a3028', '#a44a36', '#c8704e'],
  grass: ['#0e2a1a', '#1a4a26', '#2a6e30', '#43963a', '#74c050', '#b0e070'],
  leaf: ['#0a2016', '#163a22', '#22582e', '#38803a', '#5aa848', '#9ad070'],
  dirt: ['#2a180e', '#4a2e1a', '#6e4a2c', '#906640', '#b48a5a'],
  sand: ['#6a5030', '#a08050', '#c8aa70', '#e0c890', '#f4e4b8'],
  water: ['#0a1640', '#123070', '#1c4ea0', '#2a78c8', '#5aaee8', '#b8ecff'],
  deep: ['#050a24', '#0a1844', '#102a66', '#1a428a', '#2a64b0', '#7ab0e0'],
  lava: ['#3a0806', '#8a1a08', '#d8400e', '#ff7a1a', '#ffc040', '#fff4a0'],
  ice: ['#2a4a7a', '#4a7ab0', '#7ab4e0', '#a8d8f4', '#d8f4ff', '#ffffff'],
  poison: ['#0e2410', '#1e4a18', '#3a7a1e', '#6ab02a', '#a8e04a', '#e0ff9a'],
  arcane: ['#1a0a3a', '#3a1a7a', '#6a3ac0', '#9a6aff', '#c8a8ff', '#f0e0ff'],
  crystal: ['#0a2a4a', '#145a8a', '#2a96c8', '#5ad8ff', '#b0f0ff', '#ffffff'],
  corrupt: ['#0a0414', '#24082e', '#3e0e4e', '#6a1a7a', '#a02aa8', '#e070e0'],
  fel: ['#0a2a08', '#1a5a12', '#3aa01e', '#7aff5a', '#c8ffb0', '#ffffff'],
  flame: ['#8a1a08', '#e04010', '#ff8a2a', '#ffd25a', '#fff8d0'],
  ghost: ['#0a3a4a', '#1a7a9a', '#3ac8e8', '#9af4ff', '#ffffff'],
};

/** Element ramps [dark, base, light, glow] used by icons/pickups. */
export const ELEMENT_RAMPS = {
  fire: ['#8a1a08', '#ff6a1f', '#ffd25a', '#fff8d0'],
  ice: ['#1c4ea0', '#4fc8ff', '#e6fbff', '#ffffff'],
  lightning: ['#8a6a10', '#ffe14a', '#fff8c0', '#ffffff'],
  arcane: ['#3a1a7a', '#b05aff', '#ffb8ff', '#fff0ff'],
  earth: ['#3a4a12', '#8fb83a', '#e8d08a', '#fff4c8'],
  physical: ['#4a4a5a', '#c8c8d0', '#ffffff', '#ffffff'],
  corrupt: ['#24082e', '#a02aa8', '#7aff5a', '#e0ffd0'],
};
