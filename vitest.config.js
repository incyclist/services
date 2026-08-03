import { defineConfig } from 'vitest/config'
import path from 'path'

// vitest/@vitest/coverage-v8 are pinned to an exact version (not ^-ranged) in package.json.
// Vite 8's default rolldown/oxc transform can't parse this repo's native TC39 class/method
// decorators (@Singleton, @Injectable, etc.) - "SyntaxError: Invalid or unexpected token".
// Vite 7.x (pulled in by vitest 4.0.x, esbuild-based) handles them fine. Don't bump past
// vitest 4.0.x until oxc's decorator support catches up.
export default defineConfig({
    test: {
        globals: true,
        include: [
            'src/**/[^.]*.unit.{test,spec}.{ts,js}'
        ],
        exclude: [
            'src/**/[^.]*.e2e.{test,spec}.{ts,js}',
            '**/node_modules/**',
            '**/lib/**'
        ],
        environment: 'node',
        alias: {
            uuid: path.resolve(__dirname, './test/uuid.ts')
        },
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            reportsDirectory: './coverage',
            include: ['src/**/*.{js,ts}'],
            exclude: [
                'src/**/*.d.ts',
                'src/**/index.ts',
                'src/**/model.ts',
                'src/**/types.ts',
                'src/**/mock.ts',
                'src/Device.ts',
                'src/**/*.e2e.{test,tests}.{js,ts}',
                'src/**/*.integ.{test,tests}.{js,ts}',
                'src/**/*.unit.{test,tests}.{js,ts}',
                'src/**/*.test.util.{js,ts}'
            ]
        },
        globalSetup: ['./jest-setup.js'],
        setupFiles: ['./vitest.setup.ts'],
        passWithNoTests: true
    }
})
