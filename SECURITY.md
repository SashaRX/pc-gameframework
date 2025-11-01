# Security Notice

## Known Vulnerabilities

This project has 6 known vulnerabilities from the `playcanvas-sync` development dependency:

### Critical (2)
- **form-data <2.5.4**: Uses unsafe random function for choosing boundary
  - Source: `playcanvas-sync` → `request` → `form-data`
  - GHSA-fjxv-7rqg-78g4

### Moderate (4)
- **tough-cookie <4.1.3**: Prototype Pollution vulnerability
  - Source: `playcanvas-sync` → `request` → `tough-cookie`
  - GHSA-72xf-g2v4-qvf3

### Why These Exist

The vulnerabilities come from deprecated packages used by `playcanvas-sync`:
- `request` (deprecated since 2020)
- `request-promise-native` (deprecated)
- `form-data` (outdated version)
- `tough-cookie` (outdated version)

### Risk Assessment

**Risk Level: LOW for production use**

Reasons:
1. ✅ These vulnerabilities are in **development dependencies only**
2. ✅ `playcanvas-sync` is only used during development for syncing with PlayCanvas Editor
3. ✅ **Not included in production build** (build output is pure ESM modules)
4. ✅ Build artifacts (`build/esm/`) don't contain any code from these vulnerable packages

### What We've Done

- ✅ Updated all direct dependencies to latest versions:
  - `playcanvas`: 2.12.4
  - `typescript`: 5.9.3
  - `tsc-watch`: 7.2.0
- ✅ Verified build process works correctly
- ✅ Documented the issue

### Mitigation

If you're concerned about these vulnerabilities:

1. **For Production**: No action needed - vulnerable code isn't in production build
2. **For Development**: Use `npm install --omit=dev` to skip development dependencies
3. **Alternative Sync Method**: Manually upload files to PlayCanvas Editor instead of using `playcanvas-sync`

### Future Resolution

These vulnerabilities will be resolved when:
- PlayCanvas team updates `playcanvas-sync` to use modern HTTP clients (like `axios` or `node-fetch`)
- Or we migrate to an alternative sync solution

### References

- [playcanvas-sync GitHub](https://github.com/playcanvas/playcanvas-sync)
- [request deprecation notice](https://github.com/request/request/issues/3142)

---

Last updated: 2025-11-01
