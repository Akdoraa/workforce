import { useAgentStore } from "@/lib/store";
import { simulateAIResponse } from "@/lib/agent-logic";
import { Sidebar } from "@/components/Sidebar";
import { ChatArea } from "@/components/ChatArea";
import { RightPanel } from "@/components/RightPanel";

function App() {
  const store = useAgentStore();

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden text-foreground dark">
      <Sidebar 
        agents={store.agents} 
        currentAgentId={store.currentAgent?.id || null}
        onNewAgent={store.createNewAgent}
        onSwitchAgent={store.switchAgent}
      />
      
      <main className="flex-1 flex min-w-0">
        <div className="flex-1 flex flex-col border-r border-border min-w-0 relative">
          <ChatArea 
            agent={store.currentAgent} 
            onSendMessage={(text) => {
              if (store.currentAgent) {
                simulateAIResponse(text, store.currentAgent, store.updateCurrentAgent, store.addMessage);
              }
            }}
            tools={store.currentAgent?.tools || { stripe: false, jira: false, slack: false }}
            onUpdateTools={(tools) => store.updateCurrentAgent({ tools })}
          />
        </div>
        
        <div className="w-[45%] min-w-[300px] max-w-[600px] bg-card flex flex-col">
          <RightPanel agent={store.currentAgent} />
        </div>
      </main>
    </div>
  );
}

export default App;
