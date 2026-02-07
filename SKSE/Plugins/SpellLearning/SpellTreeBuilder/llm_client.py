"""
LLM Client for SpellTreeBuilder.

Makes API calls to OpenRouter for:
- Auto-configuring per-school tree settings
- Enhancing themed groups with names and colors

Requires: requests library (pip install requests)
"""

import json
import time
from typing import Dict, Any, Optional, List

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False
    print("[LLM] WARNING: 'requests' library not installed. LLM features disabled.")
    print("[LLM] Install with: pip install requests")


class LLMClient:
    """Client for making LLM API calls to OpenRouter."""
    
    def __init__(self, api_key: str, model: str = "openai/gpt-4o-mini", 
                 endpoint: str = "https://openrouter.ai/api/v1/chat/completions"):
        self.api_key = api_key
        self.model = model
        self.endpoint = endpoint
        self.timeout = 60  # seconds
        
    def is_available(self) -> bool:
        """Check if LLM client is usable."""
        if not HAS_REQUESTS:
            return False
        if not self.api_key or len(self.api_key) < 10:
            return False
        return True
    
    def call(self, prompt: str, system_prompt: Optional[str] = None, 
             max_tokens: int = 2000, temperature: float = 0.7) -> Optional[str]:
        """
        Make an LLM API call.
        
        Args:
            prompt: The user message/prompt
            system_prompt: Optional system message
            max_tokens: Maximum response tokens
            temperature: Randomness (0-1)
            
        Returns:
            Response text or None on error
        """
        if not self.is_available():
            print("[LLM] Client not available (missing API key or requests library)")
            return None
        
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/SpellLearning",
            "X-Title": "SpellLearning Tree Builder"
        }
        
        payload = {
            "model": self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature
        }
        
        try:
            print(f"[LLM] Calling {self.model}...")
            start_time = time.time()
            
            response = requests.post(
                self.endpoint,
                headers=headers,
                json=payload,
                timeout=self.timeout
            )
            
            elapsed = time.time() - start_time
            
            if response.status_code != 200:
                print(f"[LLM] Error: HTTP {response.status_code}")
                print(f"[LLM] Response: {response.text[:500]}")
                return None
            
            result = response.json()
            content = result.get('choices', [{}])[0].get('message', {}).get('content', '')
            
            print(f"[LLM] Response received in {elapsed:.1f}s ({len(content)} chars)")
            return content
            
        except requests.exceptions.Timeout:
            print(f"[LLM] Timeout after {self.timeout}s")
            return None
        except requests.exceptions.RequestException as e:
            print(f"[LLM] Request error: {e}")
            return None
        except Exception as e:
            print(f"[LLM] Unexpected error: {e}")
            return None
    
    def call_json(self, prompt: str, system_prompt: Optional[str] = None,
                  max_tokens: int = 2000, temperature: float = 0.5) -> Optional[Dict[str, Any]]:
        """
        Make an LLM call expecting JSON response.
        
        Returns parsed JSON or None on error.
        """
        response = self.call(prompt, system_prompt, max_tokens, temperature)
        if not response:
            return None
        
        # Try to extract JSON from response
        try:
            # First try direct parse
            return json.loads(response)
        except json.JSONDecodeError:
            pass
        
        # Try to find JSON in markdown code block
        import re
        json_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', response)
        if json_match:
            try:
                return json.loads(json_match.group(1))
            except json.JSONDecodeError:
                pass
        
        # Try to find raw JSON object
        json_match = re.search(r'\{[\s\S]*\}', response)
        if json_match:
            try:
                return json.loads(json_match.group(0))
            except json.JSONDecodeError:
                pass
        
        print(f"[LLM] Could not parse JSON from response: {response[:200]}")
        return None


def create_client_from_config(config: Dict[str, Any]) -> Optional[LLMClient]:
    """Create an LLM client from tree builder config."""
    llm_api = config.get('llm_api', {})
    
    api_key = llm_api.get('api_key', '')
    model = llm_api.get('model', 'openai/gpt-4o-mini')
    endpoint = llm_api.get('endpoint', 'https://openrouter.ai/api/v1/chat/completions')
    
    if not api_key:
        print("[LLM] No API key in config - LLM features disabled")
        return None
    
    client = LLMClient(api_key, model, endpoint)
    if client.is_available():
        print(f"[LLM] Client initialized with model: {model}")
        return client
    
    return None


# ============================================================================
# AUTO-CONFIGURE: LLM picks settings for each school
# ============================================================================

def auto_configure_school(client: LLMClient, school_name: str, 
                          sample_spells: List[Dict[str, Any]],
                          prompt_template: str) -> Optional[Dict[str, Any]]:
    """
    Ask LLM to recommend tree settings for a school.
    
    Args:
        client: LLM client
        school_name: Name of the magic school
        sample_spells: Sample spells from the school
        prompt_template: Prompt template with {{SCHOOL_NAME}} and {{SPELL_LIST}}
        
    Returns:
        Configuration dict or None on error
    """
    # Format spell list
    spell_list = "\n".join([
        f"- {s.get('name', s.get('formId'))}: {s.get('skillLevel', '?')}, {s.get('description', '')[:50]}"
        for s in sample_spells[:10]
    ])
    
    # Fill template
    prompt = prompt_template.replace("{{SCHOOL_NAME}}", school_name)
    prompt = prompt.replace("{{SPELL_LIST}}", spell_list)
    
    print(f"[LLM] Auto-configuring {school_name}...")
    result = client.call_json(prompt)
    
    if result:
        result['source'] = 'llm'
        print(f"[LLM] {school_name}: shape={result.get('shape')}, density={result.get('density', 0.6):.2f}")
        branching = result.get('branching_energy', {})
        print(f"[LLM]   -> branching: {branching.get('min_straight', 2)}-{branching.get('max_straight', 5)}, convergence={int(result.get('convergence_chance', 0.4) * 100)}%")
        if result.get('reasoning'):
            reason = result['reasoning'][:80] + '...' if len(result.get('reasoning', '')) > 80 else result.get('reasoning', '')
            print(f"[LLM]   -> reason: {reason}")
    
    return result


def auto_configure_all_schools(client: LLMClient, 
                                schools_data: Dict[str, List[Dict[str, Any]]],
                                prompt_template: str) -> Dict[str, Dict[str, Any]]:
    """
    Ask LLM to recommend tree settings for ALL schools at once.
    This gives the LLM context of all schools to make cohesive choices.
    
    Args:
        client: LLM client
        schools_data: Dict mapping school name -> sample spells
        prompt_template: Base prompt template (will be modified for multi-school)
        
    Returns:
        Dict mapping school name -> configuration
    """
    # Build multi-school prompt
    all_schools_info = []
    for school_name, sample_spells in schools_data.items():
        spell_list = ", ".join([
            s.get('name', s.get('formId', 'Unknown'))[:30]
            for s in sample_spells[:8]
        ])
        all_schools_info.append(f"- {school_name} ({len(sample_spells)} spells): {spell_list}")
    
    schools_section = "\n".join(all_schools_info)
    
    # Multi-school prompt
    multi_prompt = f"""Configure visual tree settings for ALL magic schools at once.

SCHOOLS AND SAMPLE SPELLS:
{schools_section}

AVAILABLE SHAPES: organic, radial, grid, cascade, mountain, spiky, cloud, linear, flame, explosion

BRANCHING MODES:
- "proximity": Traditional - connects to nearest nodes, good for compact trees
- "fuzzy_groups": Groups spells by name/effect similarity, branches by themes (fire, ice, etc.)

For EACH school, return a JSON object with this structure:
{{
  "SchoolName": {{
    "shape": "shape_name",
    "density": 0.5-0.9,
    "branching_mode": "proximity|fuzzy_groups",
    "reasoning": "brief reason"
  }},
  ... (one entry per school)
}}

IMPORTANT:
- Each school should have a DIFFERENT shape that reflects its magical nature
- Destruction = aggressive shapes (spiky, flame, explosion), fuzzy_groups works well (fire/ice/shock branches)
- Restoration = nurturing shapes (radial, organic), proximity often better
- Conjuration = ethereal shapes (cloud, spiral), fuzzy_groups for summon types
- Alteration = structured shapes (mountain, grid), proximity for clean structure
- Illusion = mysterious shapes (cloud, cascade), fuzzy_groups for mind/light effects
- MIX both branching modes across schools for variety!
- Consider how the shapes will look next to each other in the wheel

Return ONLY the JSON object, no explanation."""

    print(f"[LLM] Auto-configuring ALL {len(schools_data)} schools in one call...")
    result = client.call_json(multi_prompt, max_tokens=3000, temperature=0.6)
    
    if not result:
        print("[LLM] Failed to get multi-school config, falling back to defaults")
        return {}
    
    # Parse results for each school
    configs = {}
    for school_name in schools_data.keys():
        school_cfg = result.get(school_name, {})
        if school_cfg:
            school_cfg['source'] = 'llm'
            configs[school_name] = school_cfg
            print(f"[LLM] {school_name}: shape={school_cfg.get('shape')}, density={school_cfg.get('density', 0.6):.2f}")
        else:
            print(f"[LLM] No config for {school_name} in response")
    
    return configs


# ============================================================================
# THEMED GROUPS: LLM names groups and assigns colors
# ============================================================================

def enhance_themed_group(client: LLMClient, keywords: List[str],
                         sample_spells: List[Dict[str, Any]], 
                         prompt_template: str) -> Optional[Dict[str, Any]]:
    """
    Ask LLM to name a themed group and assign color/rules.
    
    Args:
        client: LLM client
        keywords: Common keywords for this group
        sample_spells: Sample spells from the group
        prompt_template: Prompt template with {{GROUP_KEYWORDS}} and {{SPELL_LIST}}
        
    Returns:
        Group enhancement dict or None on error
    """
    # Format data
    keywords_str = ", ".join(keywords[:5])
    spell_list = "\n".join([
        f"- {s.get('name', s.get('formId'))}: {s.get('skillLevel', '?')}"
        for s in sample_spells[:5]
    ])
    
    # Fill template
    prompt = prompt_template.replace("{{GROUP_KEYWORDS}}", keywords_str)
    prompt = prompt_template.replace("{{SPELL_LIST}}", spell_list)
    
    return client.call_json(prompt)


if __name__ == '__main__':
    # Test the client
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python llm_client.py <api_key>")
        sys.exit(1)
    
    api_key = sys.argv[1]
    client = LLMClient(api_key)
    
    if client.is_available():
        print("Testing LLM client...")
        result = client.call("Say 'Hello, SpellLearning!' in exactly 5 words.")
        print(f"Result: {result}")
    else:
        print("Client not available")
