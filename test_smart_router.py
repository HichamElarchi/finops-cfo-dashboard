import os
from openai import OpenAI

# On se connecte à notre proxy local sur le port 8001
client = OpenAI(
    api_key="pk_live_test123",
    base_url="http://localhost:8001/v1",
)

# 1. Un prompt "facile"
print("--- TEST 1 : Prompt simple ---")
print("Demandé : openai/gpt-4o")
response_easy = client.chat.completions.create(
    model="openai/gpt-4o",
    messages=[{"role": "user", "content": "Dis-moi bonjour en une phrase."}],
)
print("Utilisé :", response_easy.model)
print("Réponse 1 :", response_easy.choices[0].message.content)

# 2. Un prompt "difficile" / technique
print("\n--- TEST 2 : Prompt complexe ---")
print("Demandé : openai/gpt-4o")
response_hard = client.chat.completions.create(
    model="openai/gpt-4o",
    messages=[{"role": "user", "content": "Explique-moi comment fonctionne un arbre binaire en programmation."}],
)
print("Utilisé :", response_hard.model)
print("Réponse 2 :", response_hard.choices[0].message.content)

print("\n--- Verdict ---")
easy_ok = "deepseek" in (response_easy.model or "")
hard_ok = "gpt-4o" in (response_hard.model or "")
print("Facile → LLM éco (deepseek) :", "OK" if easy_ok else f"ÉCHEC ({response_easy.model})")
print("Difficile → LLM premium (gpt-4o) :", "OK" if hard_ok else f"ÉCHEC ({response_hard.model})")
