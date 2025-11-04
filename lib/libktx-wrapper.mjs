/**
 * Wrapper for libktx.mjs that exports the factory function
 * This allows it to be loaded as an ES module
 */

// Load libktx.mjs content and execute it to get the factory
async function loadLibktxFactory() {
  // This will be replaced at runtime with actual path
  const scriptUrl = './libktx.mjs';

  // Create script tag to load libktx
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = scriptUrl;
    script.type = 'module';

    script.onload = () => {
      // Check if LIBKTX or createKtxModule is available in global scope
      const factory = (window as any).LIBKTX || (window as any).createKtxModule;
      if (factory) {
        resolve(factory);
      } else {
        reject(new Error('Could not find libktx factory in global scope'));
      }
    };

    script.onerror = (error) => {
      reject(new Error(`Failed to load libktx.mjs: ${error}`));
    };

    document.head.appendChild(script);
  });
}

// Export the factory
export default await loadLibktxFactory();
