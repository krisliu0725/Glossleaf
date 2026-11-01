import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { cpSync, existsSync } from 'node:fs'

// 三个入口分别构建。main / preload 输出 CJS —— sandbox 下的 preload 不支持 ESM，
// 见 DESIGN.md §9.2。renderer 由 Vite 原生按 ESM 处理。
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // 数据服务是独立的 utilityProcess 入口，与主进程同批构建到 out/main/
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'data-service': resolve(__dirname, 'src/data-service/index.ts')
        },
        output: { format: 'cjs', entryFileNames: '[name].js' }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { output: { format: 'cjs' } }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    plugins: [react(), { name: 'pdfjs-offline-resources', closeBundle() {
      for (const dir of ['cmaps','standard_fonts','wasm','iccs']) {
        const source=resolve(__dirname,'node_modules/pdfjs-dist',dir)
        if(existsSync(source))cpSync(source,resolve(__dirname,'out/renderer/pdfjs',dir),{recursive:true})
      }
    } }],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    }
  }
})
