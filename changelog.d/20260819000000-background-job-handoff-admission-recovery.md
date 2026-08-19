Fix transient or ambiguously committed background-job handoffs permanently consuming worker admission and concurrency by recovering the caller-generated exact lease through the dispatch retry path.
