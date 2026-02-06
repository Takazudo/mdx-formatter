/**
 * IndentDetector - Automatic indentation detection for MDX/Markdown files
 * Analyzes content to determine the most likely indentation style and size
 */

import type { IndentStats, IndentPattern, IndentDetectorLike } from './types.js';

export class IndentDetector implements IndentDetectorLike {
  private readonly content: string;
  private readonly lines: string[];
  private indentType: 'space' | 'tab';
  private indentSize: number;
  private confidence: number;
  private stats: IndentStats;

  constructor(content: string) {
    this.content = content || '';
    this.lines = this.content.split('\n');

    // Initialize detection results
    this.indentType = 'space';
    this.indentSize = 2;
    this.confidence = 0;

    // Statistics tracking
    this.stats = {
      totalLines: this.lines.length,
      indentedLines: 0,
      patterns: {},
      tabLines: 0,
      spaceLines: 0,
    };

    // Perform detection
    this.detect();
  }

  /**
   * Main detection algorithm
   */
  detect(): void {
    if (!this.content || this.content.trim() === '') {
      // No content, use defaults
      this.confidence = 0;
      return;
    }

    const indentCounts = new Map<string, number>();
    const indentPatterns: IndentPattern[] = [];
    let inCodeBlock = false;
    let inFrontmatter = false;

    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];

      // Skip empty lines
      if (!line.trim()) {
        continue;
      }

      // Track frontmatter boundaries
      if (line.trim() === '---') {
        if (i === 0) {
          inFrontmatter = true;
          continue;
        } else if (inFrontmatter) {
          inFrontmatter = false;
          continue;
        }
      }

      // Track code block boundaries
      if (line.trim().startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        continue;
      }

      // For code blocks, we DO want to analyze their indentation
      // as it gives us hints about the file's indentation style

      // Analyze indentation
      const indent = this.getLineIndent(line);
      if (indent.length > 0) {
        this.stats.indentedLines++;

        // Check if it's tabs or spaces
        if (indent.includes('\t')) {
          this.stats.tabLines++;
          // Count tab indentations
          const tabCount = (indent.match(/\t/g) || []).length;
          this.incrementPatternCount('tab', 1);
          indentPatterns.push({ type: 'tab', size: tabCount });
        } else {
          this.stats.spaceLines++;
          // Count space indentations
          const spaceCount = indent.length;
          this.incrementPatternCount(`${spaceCount}-space`, 1);
          indentPatterns.push({ type: 'space', size: spaceCount });
        }

        // Track raw indent sizes
        const key = indent.includes('\t')
          ? `tab-${indent.split('\t').length - 1}`
          : `space-${indent.length}`;
        indentCounts.set(key, (indentCounts.get(key) || 0) + 1);
      }
    }

    // Analyze patterns to determine most likely indentation
    this.analyzePatterns(indentPatterns, indentCounts);
  }

  /**
   * Get the indentation string of a line
   */
  getLineIndent(line: string): string {
    const match = line.match(/^(\s*)/);
    return match ? match[1] : '';
  }

  /**
   * Increment pattern count in statistics
   */
  incrementPatternCount(pattern: string, count: number): void {
    if (!this.stats.patterns[pattern]) {
      this.stats.patterns[pattern] = 0;
    }
    this.stats.patterns[pattern] += count;
  }

  /**
   * Analyze collected patterns to determine indentation
   */
  analyzePatterns(patterns: IndentPattern[], _indentCounts: Map<string, number>): void {
    if (patterns.length === 0) {
      this.confidence = 0;
      return;
    }

    // Determine if tabs or spaces are more common
    if (this.stats.tabLines > this.stats.spaceLines) {
      this.indentType = 'tab';
      this.indentSize = 1;
    } else {
      this.indentType = 'space';

      // Find the most common space indent size
      // Look for indent level differences (GCD approach)
      const spaceIndents = patterns
        .filter((p) => p.type === 'space')
        .map((p) => p.size)
        .filter((size) => size > 0);

      if (spaceIndents.length > 0) {
        // Find the GCD of all indentation sizes
        this.indentSize = this.findCommonIndentSize(spaceIndents);
      }
    }

    // Calculate confidence based on consistency
    this.calculateConfidence(patterns);
  }

  /**
   * Find the most likely indent size using GCD and frequency analysis
   */
  findCommonIndentSize(sizes: number[]): number {
    // Count frequency of each size
    const sizeFreq = new Map<number, number>();
    sizes.forEach((size) => {
      sizeFreq.set(size, (sizeFreq.get(size) || 0) + 1);
    });

    // Find the GCD of all sizes to determine base indent unit
    const gcdValue = this.gcdArray(sizes);

    // If GCD gives us a reasonable result, check if it's the most common pattern
    if (gcdValue >= 2 && gcdValue <= 4) {
      // Validate GCD by checking if most indents are multiples of it
      let matchCount = 0;
      let totalCount = 0;

      for (const [size, freq] of sizeFreq) {
        totalCount += freq;
        if (size % gcdValue === 0) {
          matchCount += freq;
        }
      }

      // If GCD explains most indentations, use it
      if (matchCount / totalCount > 0.8) {
        return gcdValue;
      }
    }

    // Fallback: use the most frequent size that appears consistently
    let mostFrequent = 2;
    let maxFreq = 0;

    for (const [size, freq] of sizeFreq) {
      if (size >= 2 && size <= 8 && freq > maxFreq) {
        maxFreq = freq;
        mostFrequent = size;
      }
    }

    // Special case: if we only have 4-space indents, return 4
    if (sizeFreq.size === 1 && sizeFreq.has(4)) {
      return 4;
    }

    // Special case: if we have both 4 and 8, it's likely 4-space indentation
    if (sizeFreq.has(4) && sizeFreq.has(8) && !sizeFreq.has(2)) {
      return 4;
    }

    return mostFrequent;
  }

  /**
   * Calculate GCD of an array of numbers
   */
  gcdArray(numbers: number[]): number {
    if (numbers.length === 0) return 0;

    const gcd = (a: number, b: number): number => {
      while (b !== 0) {
        const temp = b;
        b = a % b;
        a = temp;
      }
      return a;
    };

    return numbers.reduce((acc, num) => gcd(acc, num));
  }

  /**
   * Calculate confidence score based on pattern consistency
   */
  calculateConfidence(patterns: IndentPattern[]): void {
    if (patterns.length === 0) {
      this.confidence = 0;
      return;
    }

    // Count unique indent sizes and their frequencies
    const uniqueSizes = new Set(patterns.filter((p) => p.type === 'space').map((p) => p.size));
    const sizesArray = Array.from(uniqueSizes).sort((a, b) => a - b);

    // Count frequency of each size
    const sizeFrequencies = new Map<number, number>();
    patterns
      .filter((p) => p.type === 'space')
      .forEach((p) => {
        sizeFrequencies.set(p.size, (sizeFrequencies.get(p.size) || 0) + 1);
      });

    // Check if the sizes form a consistent progression (e.g., 2, 4, 6, 8)
    let isConsistentProgression = true;
    let isLikelyNested = false;

    if (sizesArray.length > 1) {
      const baseStep = sizesArray[1] - sizesArray[0];

      // Check if it's a proper progression
      for (let i = 2; i < sizesArray.length; i++) {
        if (sizesArray[i] - sizesArray[i - 1] !== baseStep) {
          isConsistentProgression = false;
          break;
        }
      }

      // Check if the first size is the base step (indicating nested levels)
      if (sizesArray[0] !== baseStep) {
        isConsistentProgression = false;
      }

      // For a progression to be "likely nested", each size should appear roughly once
      // (like in nested levels). If we have many of one size and few of others,
      // it's likely inconsistent indentation
      if (isConsistentProgression && sizesArray.length >= 3) {
        const frequencies = Array.from(sizeFrequencies.values());
        const maxFreq = Math.max(...frequencies);
        const minFreq = Math.min(...frequencies);

        // If one indent size appears much more than others, it's not truly nested
        if (maxFreq > minFreq * 2 && patterns.length < 10) {
          isLikelyNested = false;
          isConsistentProgression = false;
        } else {
          isLikelyNested = true;
        }
      }
    }

    // If we have too many different indent sizes that don't form a consistent pattern,
    // it indicates inconsistency
    if (sizesArray.length > 2 && patterns.length < 10 && !isConsistentProgression) {
      // Small file with many different non-progressive indents = low confidence
      this.confidence = 0.3;
      return;
    }

    // If we have a consistent progression with likely nested structure, high confidence
    if (isLikelyNested && sizesArray.length > 2) {
      this.confidence = 0.95;
      return;
    }

    let consistentCount = 0;
    let inconsistentCount = 0;

    // Check how many indents match our detected pattern
    for (const pattern of patterns) {
      if (pattern.type === this.indentType) {
        if (this.indentType === 'tab') {
          if (pattern.size === 1 || pattern.size === 2) {
            consistentCount++;
          } else {
            inconsistentCount++;
          }
        } else {
          // For spaces, check if it's a multiple of our detected size
          if (pattern.size % this.indentSize === 0) {
            consistentCount++;
          } else {
            inconsistentCount++;
          }
        }
      } else {
        inconsistentCount++;
      }
    }

    // Base confidence on consistency ratio
    const consistencyRatio = consistentCount / patterns.length;

    // Very aggressive penalty for any inconsistency
    if (inconsistentCount > 0) {
      // If we have any inconsistency, cap confidence based on ratio
      const inconsistencyRatio = inconsistentCount / patterns.length;
      if (inconsistencyRatio > 0.2) {
        // More than 20% inconsistent = very low confidence
        this.confidence = Math.min(0.4, consistencyRatio * 0.5);
      } else if (inconsistencyRatio > 0.1) {
        // 10-20% inconsistent = medium confidence
        this.confidence = Math.min(0.7, consistencyRatio * 0.8);
      } else {
        // Less than 10% inconsistent = still good confidence
        this.confidence = Math.min(0.85, consistencyRatio);
      }
    } else {
      // Perfect consistency
      const sampleFactor = Math.min(patterns.length / 5, 1);
      this.confidence = 0.8 + 0.2 * sampleFactor;
    }

    // Reduce confidence if there's mixed tabs and spaces
    if (this.stats.tabLines > 0 && this.stats.spaceLines > 0) {
      this.confidence *= 0.5;
    }
  }

  /**
   * Get the detected indent size
   */
  getIndentSize(): number {
    return this.indentSize;
  }

  /**
   * Get the detected indent type ('space' or 'tab')
   */
  getIndentType(): string {
    return this.indentType;
  }

  /**
   * Get the actual indent string to use
   */
  getIndentString(): string {
    if (this.indentType === 'tab') {
      return '\t';
    } else {
      return ' '.repeat(this.indentSize);
    }
  }

  /**
   * Get the confidence score (0-1)
   */
  getConfidence(): number {
    return this.confidence;
  }

  /**
   * Format a string with the detected indentation
   */
  formatWithIndent(text: string, level: number): string {
    const indent = this.getIndentString().repeat(level);
    return indent + text;
  }
}
