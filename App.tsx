import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { BleManager, Device } from 'react-native-ble-plx';
import { request, PERMISSIONS, RESULTS } from 'react-native-permissions';
import { Buffer } from 'buffer';

interface BatteryCell {
  id: number;
  voltage: number | null;
  isCritical: boolean;
}

interface BatteryModule {
  id: number;
  cells: BatteryCell[];
}

interface GlobalVoltageStats {
  maxVoltage: number;
  minVoltage: number;
  voltageDiff: number;
  lastUpdate: string;
}

const VOLTAGE_RANGE = {
  MIN: 2.8,
  MAX: 4.25,
  WARNING_HIGH: 4.2,
  WARNING_LOW: 3.2
};

// Tesla BMS Service UUIDs (Converted from CAN IDs)
const TESLA_BMS_SERVICE = 'FF6F';
const VOLTAGE_CHARACTERISTIC = 'FF6F2'; // 6F2 → FF6F2

const App = () => {
  // State
  const [bleManager] = useState(new BleManager());
  const [devices, setDevices] = useState<Device[]>([]);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [modules, setModules] = useState<BatteryModule[]>([]);
  const [voltageStats, setVoltageStats] = useState<GlobalVoltageStats>({
    maxVoltage: 0,
    minVoltage: 0,
    voltageDiff: 0,
    lastUpdate: ''
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');

  // Initialize Bluetooth
  useEffect(() => {
    const initBluetooth = async () => {
      const granted = await checkBluetoothPermissions();
      if (!granted) {
        setError('Bluetooth permissions not granted');
        return;
      }

      startScan();
    };

    initBluetooth();

    return () => {
      bleManager.destroy();
    };
  }, []);

  // Check Bluetooth permissions (iOS)
  const checkBluetoothPermissions = async () => {
    const status = await request(PERMISSIONS.IOS.BLUETOOTH_PERIPHERAL);
    return status === RESULTS.GRANTED;
  };

  // Scan for Tesla BMS devices
  const startScan = () => {
    bleManager.startDeviceScan([TESLA_BMS_SERVICE], null, (error, device) => {
      if (error) {
        setError(`Scan error: ${error.message}`);
        return;
      }
      
      if (device?.name?.match(/Tesla|BMS/i)) {
        setDevices(prev => [...prev, device]);
      }
    });
  };

  // Connect to device
  const connectDevice = async (device: Device) => {
    setIsLoading(true);
    setConnectionState('connecting');
    setError(null);
    
    try {
      const connectedDevice = await bleManager.connectToDevice(device.id, {
        requestMTU: 185, // Tesla BMS requires larger MTU
      });
      
      await connectedDevice.discoverAllServicesAndCharacteristics();
      setConnectedDevice(connectedDevice);
      setConnectionState('connected');
      
      // Start monitoring voltage data
      connectedDevice.monitorCharacteristicForService(
        TESLA_BMS_SERVICE,
        VOLTAGE_CHARACTERISTIC,
        (error, characteristic) => {
          if (characteristic?.value) {
            processTeslaData(characteristic.value);
          }
        }
      );
      
    } catch (err) {
      setError(`Connection failed: ${(err as Error).message}`);
      setConnectionState('disconnected');
    } finally {
      setIsLoading(false);
    }
  };

  // Process Tesla BMS data (Base64 encoded)
  const processTeslaData = (base64Data: string) => {
    const now = new Date().toLocaleTimeString();
    const rawData = Buffer.from(base64Data, 'base64');
    
    // Example for Module 1 (6F2) - 8 bytes per module
    // Byte structure: [ModuleID][Cell1_Hi][Cell1_Lo][Cell2_Hi][Cell2_Lo]...
    const moduleId = rawData[0] - 0x6F; // Convert from 6F2 to module 1
    const cells: BatteryCell[] = [];
    
    for (let i = 0; i < 6; i++) {
      const offset = 1 + (i * 2);
      const voltage = rawData.readUInt16BE(offset) * 0.001; // Big-endian
      const isValid = voltage >= VOLTAGE_RANGE.MIN && voltage <= VOLTAGE_RANGE.MAX;
      
      cells.push({
        id: i + 1,
        voltage: isValid ? voltage : null,
        isCritical: !isValid
      });
    }
    
    setModules(prev => {
      const updatedModules = [...prev];
      const moduleIndex = updatedModules.findIndex(m => m.id === moduleId);
      
      if (moduleIndex >= 0) {
        updatedModules[moduleIndex] = { id: moduleId, cells };
      } else {
        updatedModules.push({ id: moduleId, cells });
      }
      
      // Calculate global stats
      const allVoltages = updatedModules
        .flatMap(m => m.cells.map(c => c.voltage))
        .filter(v => v !== null) as number[];
      
      if (allVoltages.length > 0) {
        setVoltageStats({
          maxVoltage: Math.max(...allVoltages),
          minVoltage: Math.min(...allVoltages),
          voltageDiff: Math.max(...allVoltages) - Math.min(...allVoltages),
          lastUpdate: now
        });
      }
      
      return updatedModules;
    });
  };

  // Disconnect device
  const disconnectDevice = async () => {
    if (!connectedDevice) return;
    
    try {
      await bleManager.cancelDeviceConnection(connectedDevice.id);
      setConnectedDevice(null);
      setConnectionState('disconnected');
      setModules([]);
      setVoltageStats({ maxVoltage: 0, minVoltage: 0, voltageDiff: 0, lastUpdate: '' });
    } catch (err) {
      setError(`Disconnect failed: ${(err as Error).message}`);
    }
  };

  // Get color based on voltage value
  const getVoltageColor = (voltage: number | null) => {
    if (voltage === null) return 'gray';
    if (voltage < VOLTAGE_RANGE.MIN || voltage > VOLTAGE_RANGE.MAX) return 'black';
    if (voltage > VOLTAGE_RANGE.WARNING_HIGH || voltage < VOLTAGE_RANGE.WARNING_LOW) return 'orange';
    return 'green';
  };

  // Render battery module
  const renderModule = ({ item }: { item: BatteryModule }) => (
    <View style={styles.moduleCard}>
      <Text style={styles.moduleTitle}>Module {item.id}</Text>
      <View style={styles.cellContainer}>
        {item.cells.map(cell => (
          <View key={`module-${item.id}-cell-${cell.id}`} style={styles.cell}>
            <Text style={styles.cellLabel}>Cell {cell.id}</Text>
            <Text style={[styles.cellValue, { color: getVoltageColor(cell.voltage) }]}>
              {cell.voltage ? cell.voltage.toFixed(3) + 'V' : '--'}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Digital EV Doctor BMS Monitor</Text>
      
      {/* Error Display */}
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>⚠️ {error}</Text>
          <TouchableOpacity onPress={() => setError(null)}>
            <Text style={styles.dismissText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      )}
      
      {/* Connection Status */}
      <View style={styles.statusBar}>
        {isLoading && <ActivityIndicator size="small" color="#0000ff" />}
        {connectionState === 'connected' && (
          <Text style={styles.connectedText}>
            Connected: {connectedDevice?.name}
          </Text>
        )}
        {voltageStats.lastUpdate && (
          <Text style={styles.updateText}>Last update: {voltageStats.lastUpdate}</Text>
        )}
      </View>

      {/* Global Voltage Stats */}
      <View style={styles.statsCard}>
        <Text style={styles.statsTitle}></Text>
        <View style={styles.statsGrid}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Max Voltage</Text>
            <Text style={[styles.statValue, { color: getVoltageColor(voltageStats.maxVoltage) }]}>
              {voltageStats.maxVoltage.toFixed(3)}V
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Min Voltage</Text>
            <Text style={[styles.statValue, { color: getVoltageColor(voltageStats.minVoltage) }]}>
              {voltageStats.minVoltage.toFixed(3)}V
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Voltage Diff</Text>
            <Text style={[styles.statValue, { 
              color: voltageStats.voltageDiff > 0.1 ? 'red' : 
                     voltageStats.voltageDiff > 0.05 ? 'orange' : 'green' 
            }]}>
              {voltageStats.voltageDiff.toFixed(3)}V
            </Text>
          </View>
        </View>
      </View>

      {/* Connection Controls */}
      {!connectedDevice ? (
        <>
          <View style={styles.deviceListHeader}>
            <Text style={styles.sectionTitle}>Available Devices</Text>
            <TouchableOpacity onPress={startScan}>
              <Text style={styles.refreshText}>Scan Again</Text>
            </TouchableOpacity>
          </View>
          
          <FlatList
            data={devices}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.deviceButton}
                onPress={() => connectDevice(item)}
                disabled={isLoading}
              >
                <Text style={styles.deviceName}>{item.name || 'Unknown Device'}</Text>
                <Text style={styles.deviceAddress}>{item.id}</Text>
              </TouchableOpacity>
            )}
            contentContainerStyle={styles.deviceList}
          />
        </>
      ) : (
        <TouchableOpacity
          style={styles.disconnectButton}
          onPress={disconnectDevice}
          disabled={isLoading}
        >
          <Text style={styles.disconnectText}>Disconnect</Text>
        </TouchableOpacity>
      )}

      {/* Battery Modules */}
      <Text style={styles.sectionTitle}>Battery Modules ({modules.length})</Text>
      <FlatList
        data={modules}
        renderItem={renderModule}
        keyExtractor={item => `module-${item.id}`}
        contentContainerStyle={styles.modulesList}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {connectedDevice ? 'Waiting for BMS data...' : 'Not connected'}
          </Text>
        }
      />
    </View>
  );
};

// Styles remain the same as in your original code
const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#f5f5f5'
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 8,
    color: '#333'
  },
  errorContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#ffebee',
    padding: 10,
    borderRadius: 5,
    marginBottom: 10
  },
  errorText: {
    color: '#d32f2f',
    flex: 1
  },
  dismissText: {
    color: '#1976d2',
    marginLeft: 10
  },
  statusBar: {
    marginBottom: 16,
    minHeight: 20
  },
  connectedText: {
    color: 'green',
    fontWeight: '500'
  },
  updateText: {
    color: '#666',
    fontSize: 12
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginVertical: 8,
    color: '#333'
  },
  deviceListHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8
  },
  refreshText: {
    color: '#0066cc',
    fontSize: 14
  },
  deviceList: {
    paddingBottom: 16
  },
  deviceButton: {
    padding: 12,
    marginBottom: 8,
    backgroundColor: 'white',
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#0066cc'
  },
  deviceName: {
    fontWeight: '500'
  },
  deviceAddress: {
    color: '#666',
    fontSize: 12
  },
  disconnectButton: {
    padding: 12,
    backgroundColor: '#ff4444',
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16
  },
  disconnectText: {
    color: 'white',
    fontWeight: 'bold'
  },
  statsCard: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2
  },
  statsTitle: {
    fontWeight: 'bold',
    fontSize: 16,
    marginBottom: 12,
    color: '#333'
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap'
  },
  statItem: {
    width: '48%',
    marginBottom: 12
  },
  statLabel: {
    color: '#666',
    fontSize: 14
  },
  statValue: {
    fontSize: 18,
    fontWeight: '500'
  },
  modulesList: {
    paddingBottom: 16
  },
  emptyText: {
    textAlign: 'center',
    color: '#666',
    marginTop: 16
  },
  moduleCard: {
    backgroundColor: 'white',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1
  },
  moduleTitle: {
    fontWeight: 'bold',
    fontSize: 16,
    color: '#333',
    marginBottom: 8
  },
  cellContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between'
  },
  cell: {
    width: '32%',
    marginBottom: 8
  },
  cellLabel: {
    fontSize: 12,
    color: '#666'
  },
  cellValue: {
    fontSize: 14,
    fontWeight: '500',
    marginVertical: 2
  }
});

export default App;