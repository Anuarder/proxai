# Tech Tasks for the Future

## Classifier Heuristic Signals — Revisit Approach

The current design uses weighted heuristic signals (token count, keywords, code markers, message history length, explicit instructions) for prompt complexity classification. This may not be accurate enough in practice.

**Consider:**
- Replace heuristics with LLM-based classification once API providers are available
- Use logged routing data to evaluate heuristic accuracy before investing in improvements
- Explore embedding-based classification for better semantic understanding
- Test with real traffic to identify where heuristics misroute most often
