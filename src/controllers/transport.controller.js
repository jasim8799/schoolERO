const Vehicle = require('../models/Vehicle.js');
const Route = require('../models/Route.js');

const createVehicle = async (req, res) => {
  try {
    const { vehicleNumber, driverName, driverContact, capacity } = req.body;
    const { schoolId, _id: createdBy } = req.user;

    const vehicle = await Vehicle.create({
      vehicleNumber,
      driverName,
      driverContact,
      capacity,
      schoolId,
      createdBy,
    });
    res.status(201).json(vehicle);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getVehicles = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const vehicles = await Vehicle.find({ schoolId });
    res.json({ success: true, data: vehicles });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const updateVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;
    const { vehicleNumber, driverName, driverContact, capacity } = req.body;

    const vehicle = await Vehicle.findOneAndUpdate(
      { _id: id, schoolId },
      { vehicleNumber, driverName, driverContact, capacity },
      { new: true, runValidators: true }
    );

    if (!vehicle) {
      return res.status(404).json({ success: false, message: 'Vehicle not found' });
    }

    res.json({ success: true, data: vehicle });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Vehicle number already exists'
      });
    }

    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteVehicle = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;

    const routeCount = await Route.countDocuments({ vehicleId: id, schoolId });
    if (routeCount > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete — ${routeCount} route(s) are using this vehicle. Remove or reassign routes first.`
      });
    }

    const vehicle = await Vehicle.findOneAndDelete({ _id: id, schoolId });
    if (!vehicle) {
      return res.status(404).json({ success: false, message: 'Vehicle not found' });
    }

    res.json({ success: true, message: 'Vehicle deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const createRoute = async (req, res) => {
  try {
    const { name, stops, vehicleId, monthlyFee } = req.body;
    const { schoolId, _id: createdBy } = req.user;

    const route = await Route.create({
      name,
      stops,
      vehicleId,
      monthlyFee: monthlyFee || 0,
      schoolId,
      createdBy,
    });
    res.status(201).json(route);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getRoutes = async (req, res) => {
  try {
    const { schoolId } = req.user;
    const routes = await Route.find({ schoolId }).populate('vehicleId');
    res.json({ success: true, data: routes });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const updateRoute = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;
    const { name, stops, vehicleId, monthlyFee } = req.body;

    const route = await Route.findOneAndUpdate(
      { _id: id, schoolId },
      { name, stops, vehicleId, monthlyFee },
      { new: true, runValidators: true }
    ).populate('vehicleId');

    if (!route) {
      return res.status(404).json({ success: false, message: 'Route not found' });
    }

    res.json({ success: true, data: route });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const deleteRoute = async (req, res) => {
  try {
    const { id } = req.params;
    const { schoolId } = req.user;
    const StudentTransport = require('../models/StudentTransport');

    const assignedCount = await StudentTransport.countDocuments({
      routeId: id,
      schoolId,
      status: 'ACTIVE'
    });

    if (assignedCount > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete — ${assignedCount} student(s) are assigned to this route. Remove them first.`
      });
    }

    const route = await Route.findOneAndDelete({ _id: id, schoolId });
    if (!route) {
      return res.status(404).json({ success: false, message: 'Route not found' });
    }

    res.json({ success: true, message: 'Route deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  createVehicle,
  getVehicles,
  updateVehicle,
  deleteVehicle,
  createRoute,
  getRoutes,
  updateRoute,
  deleteRoute,
};
