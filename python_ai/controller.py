"""
Local Minecraft Bot Controller Connected to Colab Server
Communicates with Phi-3 inference running on Google Colab GPU
"""

import os
import sys
import requests
import logging
from dotenv import load_dotenv
from typing import Dict, Any, Optional
import time
from nlp_engine import ColabNLPEngine

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

load_dotenv()

class MinecraftBotController:
    """Main bot controller connecting Colab AI to Node.js bot"""

    def __init__(self, colab_url: str = None):
        self.node_url = os.getenv('NODE_SERVER_URL', 'http://localhost:3000')
        
        logger.info("🚀 Initializing Minecraft Bot Controller...")
        logger.info(f"   Node.js Server: {self.node_url}")
        
        try:
            self.nlp = ColabNLPEngine(colab_url)
            logger.info("✅ Colab NLP Engine ready")
        except Exception as e:
            logger.error(f"❌ Failed to connect to Colab: {e}")
            sys.exit(1)

    def send_command(self, action: str, params: dict = None) -> dict:
        """Send command to Node.js bot"""
        try:
            logger.info(f"🔄 Sending to bot: {action}")

            response = requests.post(
                f"{self.node_url}/command",
                json={
                    "action": action,
                    "params": params or {}
                },
                timeout=120
            )

            response.raise_for_status()
            result = response.json()

            if result.get('success'):
                logger.info(f"✅ {result.get('message', 'Done')}")
            else:
                logger.warning(f"⚠️ {result.get('error', 'Failed')}")

            return result

        except requests.exceptions.ConnectionError:
            error_msg = "Cannot connect to Node.js bot (port 3000)"
            logger.error(f"❌ {error_msg}")
            return {"success": False, "error": error_msg}
        except Exception as e:
            error_msg = f"Bot error: {str(e)}"
            logger.error(f"❌ {error_msg}")
            return {"success": False, "error": error_msg}

    def get_bot_status(self) -> dict:
        """Get bot status"""
        try:
            response = requests.get(
                f"{self.node_url}/status",
                timeout=5
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"❌ Error: {e}")
            return {"error": str(e)}

    def process_command(self, text: str) -> dict:
        """Process natural language command"""
        logger.info(f"\n💬 User: {text}")

        # Get bot context
        status = self.get_bot_status()
        context = None
        
        if 'error' not in status:
            context = {
                'health': status.get('health', 20),
                'food': status.get('food', 20),
                'position': str(status.get('position', 'unknown'))
            }

        # Parse with Colab
        try:
            command = self.nlp.parse_command(text, context)

            if command.get('error'):
                logger.error(f"❌ {command['error']}")
                return {
                    "success": False,
                    "error": command['error'],
                    "message": f"I couldn't understand: {text}"
                }

            action = command.get('action')
            params = command.get('params', {})

            if not action:
                return {
                    "success": False,
                    "error": "No action",
                    "message": "Not sure what to do"
                }

            # Special handling
            if action == 'craft':
                params['useCraftingChain'] = True

            # Send to bot
            result = self.send_command(action, params)
            return result

        except Exception as e:
            logger.error(f"❌ Error: {e}")
            return {
                "success": False,
                "error": str(e),
                "message": "Error processing command"
            }

    def interactive_mode(self):
        """Interactive command interface"""
        print("\n" + "="*70)
        print("🎮 Minecraft Bot with Colab AI")
        print("🌐 Connected to: " + self.nlp.colab_url)
        print("="*70)
        print("\n📝 Examples: 'mine 10 diamonds', 'craft pickaxe', 'fight mobs'")
        print("   Commands: 'status', 'model', 'stats', 'help', 'quit'\n")

        while True:
            try:
                user_input = input("You: ").strip()

                if not user_input:
                    continue

                # Exit
                if user_input.lower() in ['quit', 'exit', 'q']:
                    print("👋 Goodbye!")
                    break

                # Status
                if user_input.lower() == 'status':
                    status = self.get_bot_status()
                    if 'error' not in status:
                        print(f"\n📊 Health: {status.get('health', 'N/A')}/20")
                        print(f"   Food: {status.get('food', 'N/A')}/20")
                        print(f"   Position: {status.get('position', 'N/A')}\n")
                    continue

                # Model info
                if user_input.lower() == 'model':
                    info = self.nlp.get_model_info()
                    print(f"\n🧠 Model Info:")
                    for key, value in info.items():
                        print(f"   {key}: {value}")
                    print()
                    continue

                # GPU stats
                if user_input.lower() == 'stats':
                    stats = self.nlp.get_stats()
                    print(f"\n📊 Colab GPU Stats:")
                    for key, value in stats.items():
                        if isinstance(value, float):
                            print(f"   {key}: {value:.2f} GB")
                        else:
                            print(f"   {key}: {value}")
                    print()
                    continue

                # Help
                if user_input.lower() in ['help', '?', 'h']:
                    print("""
📖 Commands:
  • Mining: "mine 5 diamonds"
  • Crafting: "craft a pickaxe"
  • Fighting: "kill zombies"
  • Farming: "harvest wheat"
  • Status: "status"
  • Model: "model" (show model info)
  • Stats: "stats" (GPU stats)
                    """)
                    continue

                # Process command
                result = self.process_command(user_input)

                if result.get('success'):
                    print(f"\n✅ {result.get('message', 'Done')}\n")
                else:
                    print(f"\n❌ {result.get('message', 'Failed')}\n")

            except KeyboardInterrupt:
                print("\n👋 Goodbye!")
                break
            except Exception as e:
                logger.error(f"Error: {e}")
                print(f"\n❌ Error: {e}\n")


def main():
    """Main entry point"""
    
    # Get Colab URL from environment or args
    colab_url = os.getenv('COLAB_SERVER_URL')
    
    if not colab_url and len(sys.argv) > 1:
        colab_url = sys.argv[1]
    
    if not colab_url:
        logger.error("❌ COLAB_SERVER_URL not set!")
        logger.error("\nUsage:")
        logger.error("  python controller.py <colab_url>")
        logger.error("  or set: export COLAB_SERVER_URL=https://xxxxx.ngrok.io")
        sys.exit(1)

    # Initialize controller
    controller = MinecraftBotController(colab_url)

    # Check connections
    logger.info("\n🔍 Checking connections...")
    status = controller.get_bot_status()
    
    if 'error' in status:
        logger.error("❌ Cannot connect to Node.js bot!")
        logger.error("   Make sure: npm start (in node_bot directory)")
        return

    logger.info("✅ Bot connected!")

    # Start interactive mode
    controller.interactive_mode()


if __name__ == "__main__":
    main()