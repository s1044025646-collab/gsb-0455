export function naiveZ(bytes: Buffer): number[] {
  const z = new Array<number>(bytes.length).fill(0);
  for (let i = 1; i < bytes.length; i++) {
    let k = 0;
    while (i + k < bytes.length && bytes[k] === bytes[i + k]) k++;
    z[i] = k;
  }
  return z;
}

export function naivePrefixPositions(bytes: Buffer, prefixLength: number): number[] {
  const positions: number[] = [];
  for (let i = 0; i + prefixLength <= bytes.length; i++) {
    let equal = true;
    for (let k = 0; k < prefixLength; k++) {
      if (bytes[k] !== bytes[i + k]) {
        equal = false;
        break;
      }
    }
    if (equal) positions.push(i);
  }
  return positions;
}
