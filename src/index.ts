import './scripts/Ktx2LoaderScript';

// KTX2 Loader exports
export { Ktx2ProgressiveLoader } from './ktx2-loader/Ktx2ProgressiveLoader';
export { LibktxLoader } from './ktx2-loader/LibktxLoader';
export { Ktx2LoaderScript } from './scripts/Ktx2LoaderScript';
export * from './ktx2-loader/types';

// Meshoptimizer decoder exports
export {
  MeshoptLoader,
  MeshoptDecoder,
  MeshoptMode,
  MeshoptFilter,
  MeshoptModeType,
  MeshoptFilterType
} from './meshopt-loader';