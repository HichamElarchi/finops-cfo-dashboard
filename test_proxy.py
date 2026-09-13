import os
from openai import OpenAI

client = OpenAI(
    api_key="pk_live_test123",
    base_url="http://localhost:8001/v1",
)

response = client.chat.completions.create(
    model="openai/gpt-4o",
    messages=[{"role": "user", "content": "Dis-moi bonjour en une phrase."}],
)
print("Réponse de l'IA :", response.choices[0].message.content)
