from typing import Dict, Any, Optional


class ColabNLPEngine:
    """Interface to Colab-hosted Phi-3 GGUF model"""

    def __init__(self, colab_server_url: str = None):
        """
        Initialize connection to Colab server

        Args:
            colab_server_url: URL to Colab ngrok tunnel
                            Format: https://xxxxx-xxx-xxx-xxx.ngrok.io
        """
        self.colab_url = colab_server_url or os.getenv(
            'COLAB_SERVER_URL',
            'http://localhost:5000'
        )
        
        # Normalize URL
        if not self.colab_url.startswith('http'):
            self.colab_url = 'http://' + self.colab_url
        if self.colab_url.endswith('/'):
            self.colab_url = self.colab_url.rstrip('/')

        logger.info(f"🌐 Colab Server URL: {self.colab_url}")
        
        # Test connection
        if not self._test_connection():
            raise ConnectionError("Cannot reach Colab server")

    def _test_connection(self) -> bool:
        """Test connection to Colab server"""
        try:
            logger.info("🔍 Testing connection to Colab...")
            response = requests.get(
                f"{self.colab_url}/health",
                timeout=5
            )
            response.raise_for_status()
            
            data = response.json()
            if data.get('model_loaded'):
                logger.info(f"✅ Connected to Colab server")
                logger.info(f"   GPU: {data.get('model_info', {}).get('gpu_name', 'Unknown')}")
                return True
            else:
                logger.warning("⚠️ Model not loaded on Colab")
                return False
                
        except requests.exceptions.ConnectionError:
            logger.error("❌ Cannot connect to Colab")
            return False
        except Exception as e:
            logger.error(f"❌ Connection error: {e}")
            return False

    def parse_command(self, text: str, context: Dict = None) -> Dict[str, Any]:
        """
        Parse command using Colab server

        Args:
            text: Natural language command
            context: Bot context (health, food, position)

        Returns:
            Dictionary with action, params, and error
        """
        try:
            start_time = time.time()
            
            logger.info(f"📤 Sending to Colab: {text}")

            response = requests.post(
                f"{self.colab_url}/parse",
                json={
                    'text': text,
                    'context': context or {}
                },
                timeout=30  # Longer timeout for inference
            )

            response.raise_for_status()
            result = response.json()
            
            inference_time = time.time() - start_time
            logger.info(f"⏱️  Total time: {inference_time:.2f}s")
            logger.info(f"📥 Result: {result.get('action')}")

            return result

        except requests.exceptions.Timeout:
            logger.error("❌ Request timeout - Colab might be processing")
            return {
                'action': None,
                'params': {},
                'error': 'Timeout - try again'
            }
        except requests.exceptions.ConnectionError:
            logger.error("❌ Lost connection to Colab")
            return {
                'action': None,
                'params': {},
                'error': 'Cannot reach Colab server'
            }
        except Exception as e:
            logger.error(f"❌ Error: {e}")
            return {
                'action': None,
                'params': {},
                'error': str(e)
            }

    def get_model_info(self) -> Dict[str, Any]:
        """Get model information from Colab"""
        try:
            response = requests.get(
                f"{self.colab_url}/info",
                timeout=5
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Error getting info: {e}")
            return {}

    def get_stats(self) -> Dict[str, Any]:
        """Get GPU statistics from Colab"""
        try:
            response = requests.get(
                f"{self.colab_url}/stats",
                timeout=5
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"Error getting stats: {e}")
            return {}

