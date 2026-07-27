const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { execSync } = require('child_process');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = 3001;

// Multer setup
const upload = multer({ storage: multer.memoryStorage() });

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

let documents = [];
let vectorStore = [];

async function generateEmbedding(text) {
  try {
    const response = await fetch('http://localhost:11434/api/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'nomic-embed-text',
        prompt: text.substring(0, 500) // Limit to first 500 chars for speed
      })
    });

    if (!response.ok) throw new Error('Embedding failed');
    const data = await response.json();
    return data.embedding || Array(384).fill(0); // Fallback to zeros
  } catch (error) {
    console.warn('⚠️  Ollama embedding failed, using keyword search:', error.message);
    return Array(384).fill(0); // Fallback for offline
  }
}

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB) return 0;
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return magnitudeA && magnitudeB ? dotProduct / (magnitudeA * magnitudeB) : 0;
}

async function findRelevantChunks(question, topN = 1) {
  if (vectorStore.length === 0) return [];

  // Get embedding for question
  const questionEmbedding = await generateEmbedding(question);
  const questionLower = question.toLowerCase();
  const questionWords = questionLower
    .split(/\s+/)
    .filter(w => w.length > 2)
    .map(w => w.replace(/[^\w]/g, ''));

  console.log(`🔍 Searching for: "${question}"`);
  console.log(`📍 Keywords: ${questionWords.join(', ')}`);

  const scored = vectorStore.map((doc, idx) => {
    const textLower = doc.text.toLowerCase();

    // Semantic similarity score (60%)
    const semanticScore = cosineSimilarity(questionEmbedding, doc.embedding) * 100;

    // Keyword matching score (40% - higher weight for exact matches)
    let keywordScore = 0;

    // Exact phrase match (highest priority)
    if (textLower.includes(questionLower)) {
      keywordScore += 200;
    }

    // Multi-word phrases
    for (let i = Math.min(4, questionWords.length); i >= 2; i--) {
      const phrase = questionWords.slice(0, i).join(' ');
      if (textLower.includes(phrase)) {
        keywordScore += 100 * i;
      }
    }

    // Individual word matches with frequency
    questionWords.forEach(word => {
      if (textLower.includes(word)) {
        const occurrences = (textLower.match(new RegExp(`\\b${word}\\b`, 'g')) || []).length;
        keywordScore += 40 * occurrences;
      }
    });

    // Generic: boost chunks that contain more of the question keywords
    let keywordBonus = 0;
    let matchedKeywords = 0;

    // Count how many question keywords appear in this chunk
    questionWords.forEach(word => {
      if (textLower.includes(word)) {
        matchedKeywords++;
        keywordBonus += 10;  // +10 for each matched keyword
      }
    });

    // Prefer longer, more complete chunks (more likely to be full answer)
    const lengthBonus = Math.min(doc.text.length / 50, 20);  // Up to +20 for longer chunks

    // Combined score: 60% semantic + 40% keyword
    // Bonus: matched keywords + length (prefers complete answers)
    const totalBonus = keywordBonus + lengthBonus;
    const score = (semanticScore * 0.6) + ((keywordScore + totalBonus) * 0.4);

    return { ...doc, score, semanticScore, keywordScore, matchedKeywords, idx };
  });

  // Sort and filter
  const results = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  results.forEach(r => {
    console.log(`   [Score: ${r.score.toFixed(2)}] Semantic: ${r.semanticScore.toFixed(2)} | Keyword: ${r.keywordScore} | Section: ${r.sectionBonus}`);
    console.log(`   → "${r.text.substring(0, 100)}..."`);
  });

  console.log(`   Top 5 scores:`);
  scored.slice(0, 5).forEach((r, i) => {
    console.log(`   [${i+1}] Score: ${r.score.toFixed(2)} | "${r.text.substring(0, 60)}..."`);
  });

  // Generic re-ranking: prefer complete, substantial answers
  const reranked = results
    .filter(doc => doc.score > 0)
    .map(doc => {
      let finalScore = doc.score;

      // Bonus: prefer longer chunks (more likely to be complete answers)
      // But not too long (avoid entire documents)
      const optimalLength = 200; // 200 chars is "complete thought"
      if (doc.text.length > optimalLength && doc.text.length < 2000) {
        finalScore += 5;
      }

      // Bonus: chunks with multiple question keywords get boost
      if (doc.matchedKeywords > 2) {
        finalScore += doc.matchedKeywords * 2;
      }

      // Penalty: very short chunks (likely fragments)
      if (doc.text.length < 50) {
        finalScore *= 0.7;
      }

      return { ...doc, finalScore };
    })
    .sort((a, b) => b.finalScore - a.finalScore)
    .map(doc => doc.text);

  return reranked;
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', chunks: vectorStore.length });
});

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    console.log('\n📄 Processing file...');

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileExt = req.file.originalname.split('.').pop().toLowerCase();
    const fileSize = req.file.buffer.length;
    console.log(`📋 File: ${req.file.originalname} | Size: ${fileSize} bytes | Type: .${fileExt}`);

    let fullText = '';

    // UNIVERSAL FILE HANDLER - Works with ANY format
    console.log(`\n📂 Processing: ${req.file.originalname} (.${fileExt})`);

    // Method 1: PyMuPDF extraction (handles ANY PDF)
    if (fileExt === 'pdf') {
      try {
        console.log('  ↳ Extracting with PyMuPDF...');
        const timestamp = Date.now();
        const pdfPath = `/tmp/pdf-${timestamp}.pdf`;

        // Save PDF buffer
        fs.writeFileSync(pdfPath, req.file.buffer);

        // Run Python script
        const result = execSync(`python3 ${__dirname}/extract_pdf.py "${pdfPath}"`, {
          encoding: 'utf-8',
          maxBuffer: 10 * 1024 * 1024
        });

        if (result && result.trim().length > 50) {
          fullText = result.trim();
          console.log(`  ✅ PyMuPDF extracted: ${fullText.length} chars`);
        }

        // Cleanup
        try {
          fs.unlinkSync(pdfPath);
        } catch (e) {}
      } catch (e) {
        console.log(`  ⚠️  PyMuPDF extraction failed: ${e.message}`);
      }
    }

    // Method 3: Direct text extraction
    if (!fullText || fullText.length < 50) {
      try {
        console.log('  ↳ Extracting as plain text...');
        const extracted = req.file.buffer.toString('utf-8', 0, 300000);
        if (extracted && extracted.trim().length > 50) {
          fullText = extracted;
          console.log(`  ✅ Text extracted: ${fullText.length} chars`);
        }
      } catch (e) {
        console.log(`  ⚠️  Text extraction failed`);
      }
    }

    // Method 4: Basic cleaning (preserve structure)
    if (fullText && fullText.length > 0) {
      console.log('  ↳ Validating content...');

      // Just remove extreme whitespace, keep newlines for chunking
      fullText = fullText
        .replace(/\r\n/g, '\n')  // Normalize line endings
        .replace(/\t/g, ' ')      // Convert tabs to spaces
        .substring(0, 500000);    // Limit size

      console.log(`  ✅ Validated: ${fullText.length} chars`);
    }

    // Final check
    if (!fullText || fullText.length < 30) {
      console.log('❌ Not enough text extracted');
      return res.status(400).json({ error: 'Could not extract text from file' });
    }

    console.log(`  📝 Sample: ${fullText.substring(0, 150).replace(/\n/g, ' ')}...`);

    // Smart chunking strategy
    let chunks = [];

    console.log(`\n✂️ Starting chunking (text length: ${fullText.length})`);

    // Try splitting by double newlines (natural paragraphs)
    let paragraphs = fullText.split(/\n\n+/);

    // If that didn't work well, split by single newlines
    if (paragraphs.length < 2) {
      console.log('   No double newlines found, splitting by single newlines...');
      paragraphs = fullText.split(/\n+/);
    }

    // If still no luck, split by sentences
    if (paragraphs.length < 2) {
      console.log('   No newlines found, splitting by sentences...');
      paragraphs = fullText.split(/[.!?]+/);
    }

    console.log(`   Found ${paragraphs.length} potential paragraphs`);

    let lastHeader = '';

    paragraphs.forEach((para, idx) => {
      const trimmedPara = para.trim();

      // Skip empty paragraphs
      if (trimmedPara.length < 10) return;

      // Skip contact info sections
      const upperPara = trimmedPara.toUpperCase();
      if ((upperPara.includes('EMAIL:') || upperPara.includes('MOB:') ||
           upperPara.includes('ADDRESS:')) && trimmedPara.length < 100) {
        return;
      }

      // Generic: Detect likely headers by pattern, NOT by specific field names
      // Headers are typically: short, few words, often all-caps or title-case
      const wordCount = trimmedPara.split(/\s+/).length;
      const isLikelyHeader = (
        (trimmedPara.length < 100 && wordCount < 10) && // Short line, few words
        (upperPara === trimmedPara || // All caps
         /^[A-Z][a-zA-Z\s]+$/.test(trimmedPara)) // Title case
      );

      if (isLikelyHeader) {
        lastHeader = trimmedPara;
        // Don't add header alone, wait for content
        return;
      }

      // If we have a header pending and this is content, combine them
      if (lastHeader && trimmedPara.length > 30) {
        // Combine header with content
        if (trimmedPara.length < 500) {
          chunks.push(`${lastHeader}\n${trimmedPara}`);
          lastHeader = '';
        } else {
          // Long content: add header + multiple sentence chunks
          const sentences = trimmedPara
            .split(/[.!?]+/)
            .map(s => s.trim())
            .filter(s => s.length > 20);

          sentences.forEach((sentence, i) => {
            // Add header to first chunk only
            const content = i === 0 ? `${lastHeader}\n${sentence}` : sentence;
            if (content.length > 30) {
              chunks.push(content);
            }
          });
          lastHeader = '';
        }
      } else if (trimmedPara.length > 30) {
        // No header, just add content
        if (trimmedPara.length < 400) {
          chunks.push(trimmedPara);
        } else {
          // Split long paragraph into larger chunks (combine 2-3 sentences)
          const sentences = trimmedPara
            .split(/[.!?]+/)
            .map(s => s.trim())
            .filter(s => s.length > 20);

          let combined = '';
          sentences.forEach(sentence => {
            if ((combined + sentence).length < 300) {
              combined += (combined ? ' ' : '') + sentence;
            } else {
              if (combined.length > 30) chunks.push(combined);
              combined = sentence;
            }
          });
          if (combined.length > 30) chunks.push(combined);
        }
      }
    });

    // Add any remaining header+content combination
    if (lastHeader) {
      const nextPara = paragraphs.slice(-1)[0];
      if (nextPara && nextPara.length > 30) {
        chunks.push(`${lastHeader}\n${nextPara}`);
      }
    }

    // Remove duplicates and very short chunks
    chunks = [...new Set(chunks)].filter(c => c.length > 15);

    console.log(`\n✂️ Created ${chunks.length} chunks from ${paragraphs.length} paragraphs`);
    if (chunks.length > 0) {
      console.log(`📌 Sample chunks:`);
      chunks.slice(0, 3).forEach((chunk, i) => {
        const preview = chunk.substring(0, 80).replace(/\n/g, ' ');
        console.log(`   [${i}] (${chunk.length} chars) ${preview}...`);
      });
    }

    if (chunks.length === 0) {
      console.log(`❌ WARNING: No chunks created!`);
      console.log(`   Full text length: ${fullText.length}`);
      console.log(`   Paragraphs found: ${paragraphs.length}`);
      console.log(`   Sample text: ${fullText.substring(0, 200)}`);
      return res.status(400).json({ error: 'Could not split document into meaningful chunks. Text may be corrupted.' });
    }

    // Create vector store with real embeddings from Ollama
    console.log('🤖 Generating embeddings with Ollama (nomic-embed-text)...');
    const embeddings = await Promise.all(
      chunks.slice(0, 200).map(chunk => generateEmbedding(chunk)) // Limit to 200 for speed
    );

    vectorStore = embeddings.map((embedding, idx) => ({
      id: idx,
      text: chunks[idx].substring(0, 500),
      embedding: embedding
    }));

    documents = [{
      name: req.file.originalname,
      chunks: chunks.length
    }];

    console.log(`✅ Generated ${vectorStore.length} embeddings with Ollama Llama model\n`);

    res.json({
      success: true,
      message: `✅ File processed! Found ${chunks.length} text chunks.`,
      documents,
      preview: chunks.slice(0, 3)
    });
  } catch (error) {
    console.error('❌ Upload error:', error.message);
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ask', async (req, res) => {
  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question required' });
    }

    if (vectorStore.length === 0) {
      return res.status(400).json({ error: 'Upload PDF first' });
    }

    // Find relevant chunks using Ollama embeddings + keyword matching
    const relevantChunks = await findRelevantChunks(question, 1);

    console.log(`🔍 Q: "${question}"`);
    console.log(`🧠 Using Ollama Llama embeddings for semantic search`);
    console.log(`📊 Found ${relevantChunks.length} best match`);

    res.json({
      question,
      matches: relevantChunks.slice(0, 3),
      total_found: relevantChunks.length
    });
  } catch (error) {
    console.error('❌ Ask error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 RAG System Running!`);
  console.log(`📍 Backend: http://localhost:${PORT}`);
  console.log(`🤖 Model: Ollama (orca-mini)\n`);
});