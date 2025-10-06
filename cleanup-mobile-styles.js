#!/usr/bin/env node

/**
 * Mobile Styles Cleanup Script (ES Module Version)
 * 
 * This script removes mobile media queries from Svelte component files.
 * It preserves desktop styles and page-specific mobile styles that have a comment flag.
 * 
 * Usage:
 *   node cleanup-mobile-styles.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROUTES_DIR = path.join(__dirname, 'src', 'routes');
const BACKUP_SUFFIX = '.backup';

// Media query patterns to remove
const MEDIA_QUERY_PATTERNS = [
  /@media\s*\(\s*max-width\s*:\s*\d+px\s*\)\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}/g,
  /@media\s*\(\s*max-width\s*:\s*768px\s*\)\s*and\s*\(\s*orientation\s*:\s*landscape\s*\)\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}/g,
  /@media\s*\(\s*min-width\s*:\s*\d+px\s*\)\s*and\s*\(\s*max-width\s*:\s*\d+px\s*\)\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}/g,
  /@media\s*\(\s*pointer\s*:\s*coarse\s*\)\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}/g,
];

// Flag to preserve specific mobile styles
const PRESERVE_FLAG = '/* KEEP-MOBILE */';

/**
 * Find all .svelte files in a directory recursively
 */
function findSvelteFiles(dir, fileList = []) {
  if (!fs.existsSync(dir)) {
    console.log(`⚠️  Directory not found: ${dir}`);
    return fileList;
  }

  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      findSvelteFiles(filePath, fileList);
    } else if (file.endsWith('.svelte')) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

/**
 * Remove mobile media queries from a style string
 */
function removeMobileQueries(styleContent) {
  let cleaned = styleContent;
  
  // Find sections with PRESERVE_FLAG
  const preservedSections = [];
  const preserveRegex = /\/\*\s*KEEP-MOBILE\s*\*\/[\s\S]*?(@media[^}]*\{[\s\S]*?\}[\s\S]*?\})/g;
  let match;
  
  while ((match = preserveRegex.exec(styleContent)) !== null) {
    preservedSections.push(match[1]);
  }
  
  // Remove all media queries
  MEDIA_QUERY_PATTERNS.forEach(pattern => {
    cleaned = cleaned.replace(pattern, '');
  });
  
  // Clean up multiple empty lines
  cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n');
  
  // Add back preserved sections
  if (preservedSections.length > 0) {
    cleaned += '\n\n/* Page-specific mobile styles */\n';
    preservedSections.forEach(section => {
      cleaned += section + '\n\n';
    });
  }
  
  // Trim trailing whitespace
  cleaned = cleaned.trim();
  
  return cleaned;
}

/**
 * Process a single Svelte file
 */
function processFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Extract style block
    const styleMatch = content.match(/<style>([\s\S]*?)<\/style>/);
    
    if (!styleMatch) {
      return { processed: false, reason: 'No style block found' };
    }
    
    const originalStyle = styleMatch[1];
    const cleanedStyle = removeMobileQueries(originalStyle);
    
    // Check if anything was actually removed
    if (originalStyle.trim() === cleanedStyle.trim()) {
      return { processed: false, reason: 'No mobile queries found' };
    }
    
    // Create backup
    fs.writeFileSync(filePath + BACKUP_SUFFIX, content);
    
    // Write cleaned version
    const newContent = content.replace(
      /<style>[\s\S]*?<\/style>/,
      `<style>\n${cleanedStyle}\n</style>`
    );
    
    fs.writeFileSync(filePath, newContent);
    
    return {
      processed: true,
      originalSize: originalStyle.length,
      newSize: cleanedStyle.length,
      saved: originalStyle.length - cleanedStyle.length
    };
  } catch (error) {
    return { processed: false, reason: `Error: ${error.message}` };
  }
}

/**
 * Main execution
 */
function main() {
  console.log('🧹 Mobile Styles Cleanup Script\n');
  console.log('Scanning for Svelte files...\n');
  
  const files = findSvelteFiles(ROUTES_DIR);
  
  if (files.length === 0) {
    console.log('❌ No Svelte files found in src/routes/');
    console.log('   Make sure you\'re running this from the project root directory.');
    process.exit(1);
  }
  
  console.log(`Found ${files.length} Svelte files\n`);
  
  const results = {
    processed: 0,
    skipped: 0,
    totalSaved: 0,
    files: []
  };
  
  files.forEach(filePath => {
    const result = processFile(filePath);
    const relativePath = path.relative(process.cwd(), filePath);
    
    if (result.processed) {
      results.processed++;
      results.totalSaved += result.saved;
      console.log(`✅ ${relativePath}`);
      console.log(`   Saved ${result.saved} characters (${result.originalSize} → ${result.newSize})\n`);
    } else {
      results.skipped++;
      console.log(`⏭️  ${relativePath} - ${result.reason}\n`);
    }
    
    results.files.push({ filePath: relativePath, ...result });
  });
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 Summary:');
  console.log('='.repeat(60));
  console.log(`Files processed: ${results.processed}`);
  console.log(`Files skipped: ${results.skipped}`);
  console.log(`Total characters saved: ${results.totalSaved}`);
  console.log(`Backups created: ${results.processed} (*.backup files)`);
  
  if (results.processed > 0) {
    console.log('\n✨ Done! Mobile styles have been removed from page files.');
    console.log('\n⚠️  Next steps:');
    console.log('   1. Make sure src/app.css has the new global mobile styles');
    console.log('   2. Test all pages on mobile devices');
    console.log('   3. Delete .backup files once satisfied:');
    console.log('      npm run clean-backups');
    console.log('\n📝 To restore backups if needed:');
    console.log('   npm run restore-backups');
  } else {
    console.log('\n⚠️  No files were modified.');
    console.log('   This might mean:');
    console.log('   - Mobile styles were already cleaned up');
    console.log('   - No mobile @media queries were found');
  }
}

// Run the script
main();