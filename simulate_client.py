"""
Simule une entreprise : 2 prompts passent par le proxy.
Les usages apparaissent dans le dashboard du CFO qui a invité ce Developer.

1. Page Developer : Save OpenRouter, puis Generate Proxy API Key
2. Dans le terminal :

   export PROXY_API_KEY='pk_live_...'
   python3 simulate_client.py

3. Recharge le dashboard CFO
"""

import os
from pathlib import Path

from openai import OpenAI, BadRequestError

ROOT = Path(__file__).resolve().parent
API_KEY = (os.environ.get("PROXY_API_KEY") or "").strip()
BASE_URL = (os.environ.get("PROXY_BASE_URL") or "https://finops-cfo-dashboard.vercel.app/v1").rstrip("/")

PROMPTS = [
    ("Facile", "Dis-moi bonjour en une phrase."),
    ("Difficile", "Explique-moi comment fonctionne un arbre binaire en programmation."),
]

def load_dotenv_file(path: Path) -> None:
    if not path.exists():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        os.environ.setdefault(name.strip(), value.strip().strip('"').strip("'"))


load_dotenv_file(ROOT / ".env")

if not API_KEY.startswith("pk_live_") or API_KEY == "pk_live_test123":
    raise SystemExit(
        "Il faut la vraie clé de la page Developer, pas pk_live_test123.\n"
        "  export PROXY_API_KEY='pk_live_...'\n"
        "  python3 simulate_client.py"
    )

client = OpenAI(api_key=API_KEY, base_url=BASE_URL)

print(f"Proxy : {BASE_URL}")
for label, prompt in PROMPTS:
    print(f"\n--- {label} ---")
    print("Prompt :", prompt)
    try:
        response = client.chat.completions.create(
            model="openai/gpt-4o",
            messages=[{"role": "user", "content": prompt}],
        )
    except BadRequestError as exc:
        message = str(exc)
        if "No OpenRouter key" in message:
            raise SystemExit(
                "Ce workspace n'a pas encore de clé OpenRouter.\n"
                "1. Ouvre https://finops-cfo-dashboard.vercel.app/developer\n"
                "2. Colle ta clé sk-or-... dans Company OpenRouter key\n"
                "3. Clique Save OpenRouter\n"
                "4. Relance : python3 simulate_client.py"
            ) from exc
        raise
    print("Modèle utilisé :", response.model)
    print("Réponse :", response.choices[0].message.content)

print("\nRecharge le dashboard CFO : Workspace usage.")
