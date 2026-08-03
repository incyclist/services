import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
    test: {
        globals: true,
        include: [
            'src/**/[^.]*.e2e.{test,spec}.{ts,js}'
        ],
        exclude: [
            'src/**/[^.]*.unit.{test,spec}.{ts,js}',
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
            reportsDirectory: './coverage.e2e',
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
