#!/usr/bin/env bash

set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
package_dir="${root_dir}/node_modules/@mcp-b/webmcp-polyfill"
vendor_dir="${root_dir}/js/vendor/webmcp-polyfill"

mkdir -p "${vendor_dir}"
cp "${package_dir}/dist/index.iife.js" "${vendor_dir}/webmcp-polyfill.js"
cp "${package_dir}/LICENSE.webmcp-polyfill" "${vendor_dir}/LICENSE"
node -p "require('${package_dir}/package.json').version" > "${vendor_dir}/VERSION"
