import tseslint from 'typescript-eslint';

export default tseslint.config({
  files: ['src/**/*.ts'],
  ignores: ['src/wasm-pkg/**'],
  extends: [...tseslint.configs.recommended],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    // Disable rules that fire on legitimate patterns already in use
    '@typescript-eslint/no-unused-vars': 'off',
  },
});
