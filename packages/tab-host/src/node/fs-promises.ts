import { tabVolume } from "../volume";

export const { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } = tabVolume.promises;

export default tabVolume.promises;
