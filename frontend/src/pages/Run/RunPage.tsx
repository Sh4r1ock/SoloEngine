import React from 'react';
import RunPanel from '../../components/RunPanel/RunPanel';

const RunPage: React.FC = () => {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <RunPanel />
    </div>
  );
};

export default RunPage;
