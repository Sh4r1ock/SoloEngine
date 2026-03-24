import React from 'react';
import { useParams } from 'react-router-dom';
import RunPanel from '../../components/RunPanel';

const RunPage: React.FC = () => {
  const { agenticFlowId } = useParams<{ agenticFlowId?: string }>();

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <RunPanel agenticFlowId={agenticFlowId} />
    </div>
  );
};

export default RunPage;
