# System Architecture Diagrams

## Complete RAG Pipeline Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                          │
│                    (React ChatGPT-style UI)                     │
│                    http://localhost:3000                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │  Upload Page    │
                    │  - Drag & drop  │
                    │  - File select  │
                    │  - Progress bar │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Chat Page      │
                    │  - Messages     │
                    │  - Input box    │
                    │  - Suggestions  │
                    └────────┬────────┘
                             │
        ┌────────────────────▼────────────────────┐
        │     EXPRESS.JS BACKEND API              │
        │       http://localhost:3001             │
        │                                         │
        │  ┌─────────────────────────────────┐   │
        │  │ POST /api/upload                │   │
        │  │ - Receive multipart file        │   │
        │  │ - Save temporarily              │   │
        │  └──────────┬──────────────────────┘   │
        │             │                          │
        │  ┌──────────▼──────────────────────┐   │
        │  │ PyMuPDF Text Extraction         │   │
        │  │ extract_pdf.py                  │   │
        │  │ - Extract from PDF              │   │
        │  │ - Extract from TXT              │   │
        │  │ - Handle scanned PDFs           │   │
        │  └──────────┬──────────────────────┘   │
        │             │                          │
        │  ┌──────────▼──────────────────────┐   │
        │  │ Smart Chunking                  │   │
        │  │ - Generic header detection      │   │
        │  │ - Split by paragraphs           │   │
        │  │ - Sentence-level chunking       │   │
        │  │ - 40-60 chunks per doc          │   │
        │  └──────────┬──────────────────────┘   │
        │             │                          │
        │  ┌──────────▼──────────────────────┐   │
        │  │ Embedding Generation (Ollama)   │   │
        │  │ - nomic-embed-text model        │   │
        │  │ - 384-dimensional vectors       │   │
        │  │ - Cosine similarity ready       │   │
        │  └──────────┬──────────────────────┘   │
        │             │                          │
        │  ┌──────────▼──────────────────────┐   │
        │  │ Vector Store (In-Memory)        │   │
        │  │ - Store chunks + embeddings     │   │
        │  │ - JavaScript Array              │   │
        │  │ - ~10MB per 1000 chunks         │   │
        │  └──────────┬──────────────────────┘   │
        │             │                          │
        │  ┌──────────┴──────────────────────┐   │
        │  │ POST /api/ask                   │   │
        │  │ - Receive question              │   │
        │  │ - Generate embedding            │   │
        │  │ - Score all chunks              │   │
        │  └──────────┬──────────────────────┘   │
        │             │                          │
        │  ┌──────────▼──────────────────────┐   │
        │  │ Hybrid Search                   │   │
        │  │ - 60% Semantic (cosine sim)     │   │
        │  │ - 40% Keyword matching          │   │
        │  │ - Re-ranking algorithm          │   │
        │  └──────────┬──────────────────────┘   │
        │             │                          │
        │  ┌──────────▼──────────────────────┐   │
        │  │ Results & Ranking               │   │
        │  │ - Sort by score                 │   │
        │  │ - Return top 1 match            │   │
        │  │ - Exact text from document      │   │
        │  └──────────┬──────────────────────┘   │
        └─────────────┼─────────────────────────┘
                      │
                      └──────────────┐
                                     │
                    ┌────────────────▼────────┐
                    │  API Response           │
                    │  {                      │
                    │    question: "...",     │
                    │    matches: ["..."],    │
                    │    total_found: 1       │
                    │  }                      │
                    └────────────────┬────────┘
                                     │
                    ┌────────────────▼────────┐
                    │  Display in Chat        │
                    │  - Format answer        │
                    │  - Scroll to view       │
                    │  - Add to history       │
                    └────────────────────────┘
```

---

## Search Algorithm Flow

```
User Question: "What company do you work for?"
         │
         ▼
┌─────────────────────────────────────┐
│ Extract Keywords                    │
│ ["company", "work", "for"]          │
│ (filter common words)               │
└────────────┬────────────────────────┘
             │
             ├────────────────────────┐
             │                        │
             ▼                        ▼
    ┌──────────────────┐    ┌────────────────────┐
    │ Semantic Score   │    │ Keyword Score      │
    │ (60% weight)     │    │ (40% weight)       │
    │                  │    │                    │
    │ Cosine          │    │ - Exact phrase: +200
    │ Similarity      │    │ - Multi-word: +100 │
    │ 0-100 scale     │    │ - Words: +40 each  │
    │                  │    │ - Section bonus: +50
    └────────┬─────────┘    └────────┬───────────┘
             │                       │
             └───────────┬───────────┘
                         │
            ┌────────────▼────────────┐
            │ Combine Scores          │
            │ score = (semantic*0.6)  │
            │       + (keyword*0.4)   │
            └────────────┬────────────┘
                         │
            ┌────────────▼────────────┐
            │ Re-ranking Boost        │
            │ - Chunk length bonus    │
            │ - Multiple keywords     │
            │ - Fragment penalty      │
            └────────────┬────────────┘
                         │
            ┌────────────▼────────────┐
            │ Sort by Final Score     │
            │ Top 1-5 results         │
            └────────────┬────────────┘
                         │
                    Return Best Match
```

---

## Data Flow Diagram

```
UPLOAD FLOW:
────────────

PDF/TXT File (45KB)
    │
    ▼
Form Data (multipart)
    │
    ▼
HTTP POST /api/upload
    │
    ▼
Save to /tmp/pdf-TIMESTAMP.pdf
    │
    ▼
Execute: python3 extract_pdf.py "/tmp/..."
    │
    ├─ Try PyMuPDF extraction
    │  │
    │  ├─ PDF? → fitz.open() → Extract text
    │  ├─ TXT? → Read as utf-8 → Extract text
    │  └─ Scanned? → PyMuPDF handles it!
    │
    ▼
Text output (15KB)
    │
    ▼
Normalize & clean
    │
    ├─ Replace \r\n → \n
    ├─ Tabs → spaces
    └─ Limit to 500KB
    │
    ▼
Smart Chunking
    │
    ├─ Try: Split by \n\n (paragraphs)
    ├─ Try: Split by \n (lines)
    └─ Try: Split by . ! ? (sentences)
    │
    ▼
Chunk Array (42 chunks)
    │
    ├─ Chunk 1: "PROFESSIONAL SUMMARY..."
    ├─ Chunk 2: "PROFESSIONAL EXPERIENCE..."
    ├─ Chunk 3: "TECHNICAL SKILLS..."
    └─ ... 39 more chunks
    │
    ▼
Generate Embeddings
    │
    ├─ For each chunk:
    │  └─ POST to Ollama /api/embeddings
    │     ├─ Model: nomic-embed-text
    │     └─ Returns: 384D vector
    │
    ▼
Vector Store (In-Memory)
    │
    └─ [
       {
         id: 0,
         text: "PROFESSIONAL SUMMARY...",
         embedding: [0.45, -0.12, 0.89, ...]
       },
       ...42 chunks total
       ]


SEARCH FLOW:
────────────

User Question
    │
    ▼
"What company do you work for?"
    │
    ▼
Extract Keywords
    ├─ "company" ✓
    ├─ "work" ✓
    └─ "for" (filtered out)
    │
    ▼
Generate Question Embedding
    │
    └─ POST to Ollama
       └─ Returns: [0.67, -0.23, 0.54, ...]
    │
    ▼
Score Each Chunk
    │
    ├─ Chunk 1 (SUMMARY):
    │  ├─ Semantic: 45 (moderate match)
    │  ├─ Keyword: 20 (partial match)
    │  └─ Score: 38.2
    │
    ├─ Chunk 2 (EXPERIENCE):
    │  ├─ Semantic: 78 (strong match)
    │  ├─ Keyword: 250 (company+work found)
    │  └─ Score: 145.8 ✓ BEST
    │
    └─ ... 40 more chunks
    │
    ▼
Sort by Score (Descending)
    │
    ▼
Return Top 1 Result
    │
    └─ "PROFESSIONAL EXPERIENCE
       Staff Engineer - iOS at XYZ Corporation
       09/2021 to Current..."
    │
    ▼
Send to Frontend
    │
    └─ JSON Response
       {
         "question": "What company...",
         "matches": ["PROFESSIONAL..."],
         "total_found": 1
       }
    │
    ▼
Display in Chat Bubble
    │
    └─ User sees exact answer! ✅
```

---

## Component Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    FRONTEND (React)                      │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │ App.js (Main Component)                            │ │
│  │                                                    │ │
│  │ State:                                             │ │
│  │ - file, uploaded, messages[], input, loading       │ │
│  │                                                    │ │
│  │ ┌──────────────────────────────────────────────┐  │ │
│  │ │ Upload Page (conditional render)             │  │ │
│  │ │ - File input                                 │  │ │
│  │ │ - Drag-drop zone                             │  │ │
│  │ │ - Upload button                              │  │ │
│  │ └──────────────────────────────────────────────┘  │ │
│  │                                                    │ │
│  │ ┌──────────────────────────────────────────────┐  │ │
│  │ │ Chat Page (conditional render)               │  │ │
│  │ │ ┌──────────────────────────────────────────┐ │  │ │
│  │ │ │ Header                                   │ │  │ │
│  │ │ │ - File name + Change File button         │ │  │ │
│  │ │ └──────────────────────────────────────────┘ │  │ │
│  │ │ ┌──────────────────────────────────────────┐ │  │ │
│  │ │ │ Messages Container                       │ │  │ │
│  │ │ │ - User messages (green, right)           │ │  │ │
│  │ │ │ - Bot messages (gray, left)              │ │  │ │
│  │ │ │ - Auto-scroll to bottom                  │ │  │ │
│  │ │ │ - Suggested questions                    │ │  │ │
│  │ │ └──────────────────────────────────────────┘ │  │ │
│  │ │ ┌──────────────────────────────────────────┐ │  │ │
│  │ │ │ Input Area                               │ │  │ │
│  │ │ │ - Text input field                       │ │  │ │
│  │ │ │ - Send button                            │ │  │ │
│  │ │ │ - "Powered by semantic search" text      │ │  │ │
│  │ │ └──────────────────────────────────────────┘ │  │ │
│  │ └──────────────────────────────────────────────┘  │ │
│  │                                                    │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  App.css (Styles)                                       │
│  - Gradient background                                  │
│  - Message bubble styling                               │
│  - ChatGPT-inspired design                              │
│  - Responsive layout                                    │
└──────────────────────────────────────────────────────────┘
         │                                │
         │ HTTP/JSON                      │ HTTP/JSON
         │ Fetch API                      │ Fetch API
         │                                │
    ┌────▼────────────────────────────────▼────┐
    │      EXPRESS.JS BACKEND (Node.js)        │
    │                                          │
    │  server.js (Main Server)                 │
    │                                          │
    │  ┌────────────────────────────────────┐  │
    │  │ CORS Middleware                    │  │
    │  │ - Allow frontend origin            │  │
    │  │ - Allow JSON parsing               │  │
    │  │ - Multer for file upload           │  │
    │  └────────────────────────────────────┘  │
    │                                          │
    │  ┌────────────────────────────────────┐  │
    │  │ POST /api/upload                   │  │
    │  │ - Receive file                     │  │
    │  │ - Call PyMuPDF extraction          │  │
    │  │ - Run chunking                     │  │
    │  │ - Generate embeddings              │  │
    │  │ - Store in vectorStore             │  │
    │  └────────────────────────────────────┘  │
    │                                          │
    │  ┌────────────────────────────────────┐  │
    │  │ POST /api/ask                      │  │
    │  │ - Receive question                 │  │
    │  │ - Run search algorithm             │  │
    │  │ - Return best matches              │  │
    │  └────────────────────────────────────┘  │
    │                                          │
    │  ┌────────────────────────────────────┐  │
    │  │ GET /api/health                    │  │
    │  │ - Return status & chunk count      │  │
    │  └────────────────────────────────────┘  │
    │                                          │
    │  ┌────────────────────────────────────┐  │
    │  │ Vector Store (In-Memory)           │  │
    │  │ - JavaScript Array                 │  │
    │  │ - Store chunks + embeddings        │  │
    │  │ - Cleared on new upload            │  │
    │  └────────────────────────────────────┘  │
    │                                          │
    │  ┌────────────────────────────────────┐  │
    │  │ Search Functions                   │  │
    │  │ - generateEmbedding()              │  │
    │  │ - cosineSimilarity()               │  │
    │  │ - findRelevantChunks()             │  │
    │  │ - Scoring algorithm                │  │
    │  └────────────────────────────────────┘  │
    │                                          │
    └──────────────┬───────────────────────────┘
                   │
                   │ spawn subprocess
                   │ python3 extract_pdf.py
                   │
    ┌──────────────▼───────────────────────────┐
    │  PYTHON PDF EXTRACTION                   │
    │                                          │
    │  extract_pdf.py                          │
    │                                          │
    │  ┌────────────────────────────────────┐  │
    │  │ PyMuPDF (fitz)                     │  │
    │  │ - Read PDF file                    │  │
    │  │ - Extract text layer               │  │
    │  │ - Handle scanned PDFs              │  │
    │  │ - Return raw text                  │  │
    │  └────────────────────────────────────┘  │
    │                                          │
    └──────────────┬───────────────────────────┘
                   │
                   │ stdout
                   │
         Backend processes text
```

---

## Technology Stack

```
FRONTEND:
├─ React (UI framework)
├─ HTML5 (Markup)
├─ CSS3 (Styling)
└─ Fetch API (HTTP client)

BACKEND:
├─ Node.js (Runtime)
├─ Express.js (Web framework)
├─ Multer (File upload)
├─ CORS (Cross-origin)
└─ dotenv (Config)

AI/ML:
├─ Ollama (LLM server)
├─ nomic-embed-text (Embeddings)
├─ Cosine Similarity (Vector comparison)
└─ PyMuPDF (PDF extraction)

DEPLOYMENT:
├─ Local (Development)
├─ Docker (Optional containerization)
└─ PostgreSQL + pgvector (Production upgrade)
```

---

## Performance Architecture

```
UPLOAD OPTIMIZATION:
- PyMuPDF: Direct PDF parsing (no API calls)
- In-memory storage: No database overhead
- Async processing: Non-blocking chunking
- Single pass: Extract → Chunk → Embed

SEARCH OPTIMIZATION:
- Vector indexing: O(n) similarity search
- Caching: Embeddings pre-computed
- Re-ranking: Efficient sorting
- Pruning: Top-K results only

SCALING PATH:
Current:     In-memory → Fast but limited to 1 session
+1: Vector DB      → PostgreSQL + pgvector → Multi-user
+2: Caching        → Redis → Faster searches
+3: Async jobs     → Celery → Background processing
+4: Load balancing → Docker → Multiple instances
```
