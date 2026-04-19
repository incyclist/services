import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
    { ignores: ['lib/**', 'samples/**', 'tools/**', 'coverage/**', '*.cjs', '*.mjs', '*.js', '**/*.test.ts', '**/*.unit.test.ts', 'test/**', '__tests__/**'] },

    js.configs.recommended,
    ...tseslint.configs.recommended,

    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.es2021,
                ...globals.node,
            },
            parserOptions: {
                project: ['./tsconfig.base.json', './tsconfig.esm.json', './tsconfig.cjs.json'],
                tsconfigRootDir: import.meta.dirname,                
            }
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',       // was error, too noisy in tests
            '@typescript-eslint/no-unused-vars': 'warn',        // same
            '@typescript-eslint/no-require-imports': 'warn',    // .cjs files legitimately use require
            '@typescript-eslint/no-unused-expressions': 'off',  // chai-style assertions

        }
    }
);